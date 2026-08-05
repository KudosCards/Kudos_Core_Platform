import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CLICK_AND_DROP_CLIENT } from "./click-and-drop-client.provider";
import type { ClickAndDropClient, ClickAndDropProbeResult } from "./click-and-drop-client";

/** Everything needed to build one Click & Drop order from a fulfillment job. */
const IMPORT_SELECT = {
  id: true,
  clickAndDropOrderId: true,
  orderRecipient: {
    select: {
      shippingAddressLine1: true,
      shippingAddressLine2: true,
      shippingAddressCity: true,
      shippingAddressPostcode: true,
      shippingAddressCountry: true,
      postageClass: true,
      priceMinor: true,
      recipient: { select: { firstName: true, lastName: true } },
      batchOrder: { select: { orderNumber: true, createdAt: true } },
    },
  },
} satisfies Prisma.FulfillmentJobSelect;

type ImportJob = Prisma.FulfillmentJobGetPayload<{ select: typeof IMPORT_SELECT }>;

/** The reference we stamp on a card's Click & Drop order — unique, human-readable
 * and ≤40 chars. Defined once so the sweep (what we send) and the import-status
 * readout (what we tell the operator to search for) can never drift apart. */
function orderReferenceFor(jobId: string, orderNumber: number): string {
  return `ORD-${orderNumber}-${jobId.slice(0, 8)}`;
}

/** One sampled card in the import-status readout — enough to search Click & Drop
 * for it and confirm our orders land in the right dashboard account. */
export interface ClickAndDropImportSample {
  jobId: string;
  /** The reference we stamp on the Click & Drop order (`ORD-<n>-<jobId8>`), so an
   * operator can search the dashboard for the exact string we sent. */
  orderReference: string;
  /** Royal Mail's stored order id (null on the error samples, which never got one). */
  orderIdentifier: string | null;
  /** The stored import error (only on error samples). */
  error: string | null;
  /** The precise moment this card imported into Click & Drop (null on error
   * samples, which never imported). */
  importedAt: Date | null;
  /** When the row last changed — the timestamp for error samples (last-failed). */
  updatedAt: Date;
}

/**
 * A readout of where our fulfillment jobs stand relative to Click & Drop: how
 * many have imported (have a stored order id), how many errored, and how many
 * are still awaiting a push — plus a few sampled references so an operator can
 * confirm our orders appear in the same dashboard account as any legacy orders.
 */
export interface ClickAndDropImportStatus {
  enabled: boolean;
  imported: number;
  errored: number;
  awaiting: number;
  recentImports: ClickAndDropImportSample[];
  recentErrors: ClickAndDropImportSample[];
}

/** Everything a status sample needs: the job id, the order number for the
 * reference, the stored id/error and the timestamp. */
const SAMPLE_SELECT = {
  id: true,
  clickAndDropOrderId: true,
  clickAndDropError: true,
  clickAndDropImportedAt: true,
  updatedAt: true,
  orderRecipient: { select: { batchOrder: { select: { orderNumber: true } } } },
} satisfies Prisma.FulfillmentJobSelect;

type SampleRow = Prisma.FulfillmentJobGetPayload<{ select: typeof SAMPLE_SELECT }>;

/** How many sampled rows to return per band in the readout. */
const SAMPLE_LIMIT = 5;

/** Cap per sweep so a backlog is worked through in bounded batches. */
const SWEEP_BATCH = 200;
/** A failed card is auto-retried by the sweep only once its error is this old,
 * so a transient Royal Mail blip self-heals without spamming logs or the API. */
const RETRY_AFTER_MINUTES = 30;

/**
 * Imports paid cards into the operator's Royal Mail Click & Drop dashboard queue
 * via the Click & Drop Orders API — one order per card (each recipient's
 * address). A background sweep does the pushing, so the money path (Stripe /
 * wallet / auto-send / RTS re-send) is entirely decoupled: it just creates the
 * FulfillmentJob and the sweep picks it up. A card is pushed at most once (the
 * stored `clickAndDropOrderId` is the idempotency guard). See ADR 0095.
 */
@Injectable()
export class ClickAndDropService {
  private readonly logger = new Logger(ClickAndDropService.name);
  /** Guards against overlapping sweeps if one runs long. */
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLICK_AND_DROP_CLIENT) private readonly client: ClickAndDropClient,
  ) {}

  /** Whether Click & Drop import is wired (drives the ops UI + skips the sweep). */
  enabled(): boolean {
    return this.client.enabled;
  }

  /**
   * A live connectivity + auth check an operator can run on demand: fires one
   * real read-only call to the Click & Drop API and returns the raw status +
   * body, so a bad key or wrong base URL is diagnosable in seconds instead of
   * waiting for the sweep to fail. Never creates an order. Returns `enabled:false`
   * (no call made) when the key is unset.
   */
  async testConnection(): Promise<ClickAndDropProbeResult & { enabled: boolean }> {
    const result = await this.client.probe();
    return { enabled: this.client.enabled, ...result };
  }

  /**
   * Where our fulfillment jobs stand relative to Click & Drop — the ops readout.
   * Splits every job into three disjoint bands by its stored import state:
   * `imported` (has an order id), `errored` (no id, last push failed) and
   * `awaiting` (no id, never tried). Adds a few sampled references per band so an
   * operator can search the dashboard for a known `ORD-…` string and confirm our
   * orders land in the same account as any legacy (e.g. WooCommerce) orders. The
   * counts are computed even when import is disabled — the awaiting backlog is
   * still worth seeing before the key is set.
   */
  async importStatus(): Promise<ClickAndDropImportStatus> {
    const [imported, errored, awaiting, importRows, errorRows] = await Promise.all([
      this.prisma.fulfillmentJob.count({ where: { clickAndDropOrderId: { not: null } } }),
      this.prisma.fulfillmentJob.count({
        where: { clickAndDropOrderId: null, clickAndDropError: { not: null } },
      }),
      this.prisma.fulfillmentJob.count({
        where: { clickAndDropOrderId: null, clickAndDropError: null },
      }),
      this.prisma.fulfillmentJob.findMany({
        where: { clickAndDropOrderId: { not: null } },
        orderBy: { clickAndDropImportedAt: "desc" },
        take: SAMPLE_LIMIT,
        select: SAMPLE_SELECT,
      }),
      this.prisma.fulfillmentJob.findMany({
        where: { clickAndDropOrderId: null, clickAndDropError: { not: null } },
        orderBy: { updatedAt: "desc" },
        take: SAMPLE_LIMIT,
        select: SAMPLE_SELECT,
      }),
    ]);

    return {
      enabled: this.client.enabled,
      imported,
      errored,
      awaiting,
      recentImports: importRows.map((row) => this.toSample(row)),
      recentErrors: errorRows.map((row) => this.toSample(row)),
    };
  }

  private toSample(row: SampleRow): ClickAndDropImportSample {
    return {
      jobId: row.id,
      orderReference: orderReferenceFor(row.id, row.orderRecipient.batchOrder.orderNumber),
      orderIdentifier: row.clickAndDropOrderId,
      error: row.clickAndDropError,
      importedAt: row.clickAndDropImportedAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Runs every 5 minutes: import any paid card not yet in Click & Drop. No-op
   * when import is disabled or a previous sweep is still running. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledSweep(): Promise<void> {
    if (!this.client.enabled || this.sweeping) return;
    this.sweeping = true;
    try {
      const { imported, failed } = await this.sweep();
      if (imported || failed) {
        this.logger.log(`Click & Drop sweep: ${imported} imported, ${failed} failed`);
      }
    } catch (error) {
      this.logger.error(
        `Click & Drop sweep failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * Push each not-yet-imported card into Click & Drop. Picks cards never tried
   * (no stored error) plus previously-failed cards whose error has aged past the
   * retry window, so a transient outage self-heals. Best-effort per card — a
   * failure is recorded on the job and skipped so the rest still import.
   */
  async sweep(): Promise<{ imported: number; failed: number }> {
    if (!this.client.enabled) return { imported: 0, failed: 0 };
    const retryBefore = new Date(Date.now() - RETRY_AFTER_MINUTES * 60_000);
    const jobs = await this.prisma.fulfillmentJob.findMany({
      where: {
        clickAndDropOrderId: null,
        OR: [{ clickAndDropError: null }, { updatedAt: { lt: retryBefore } }],
      },
      select: IMPORT_SELECT,
      orderBy: { createdAt: "asc" },
      take: SWEEP_BATCH,
    });
    let imported = 0;
    let failed = 0;
    for (const job of jobs) {
      const error = await this.pushOne(job);
      if (error === null) imported += 1;
      else failed += 1;
    }
    return { imported, failed };
  }

  /**
   * Retry a single card's import on demand (an ops action). Throws on failure so
   * the endpoint surfaces the reason; the same reason is stored on the job. A
   * card already imported is a no-op.
   */
  async retryJob(jobId: string): Promise<void> {
    if (!this.client.enabled) {
      throw new Error("Click & Drop import is not configured (CLICK_AND_DROP_API_KEY unset)");
    }
    const job = await this.prisma.fulfillmentJob.findUnique({
      where: { id: jobId },
      select: IMPORT_SELECT,
    });
    if (!job) throw new NotFoundException("Fulfillment job not found");
    if (job.clickAndDropOrderId) return;
    const error = await this.pushOne(job);
    if (error !== null) throw new Error(error);
  }

  /** Push one card. Returns null on success, or the error message on failure
   * (also persisted). Never throws. */
  private async pushOne(job: ImportJob): Promise<string | null> {
    const r = job.orderRecipient;
    try {
      const result = await this.client.createOrder({
        orderReference: orderReferenceFor(job.id, r.batchOrder.orderNumber),
        recipientName: `${r.recipient.firstName} ${r.recipient.lastName}`.trim(),
        addressLine1: r.shippingAddressLine1,
        addressLine2: r.shippingAddressLine2,
        city: r.shippingAddressCity,
        postcode: r.shippingAddressPostcode,
        country: r.shippingAddressCountry,
        postageClass: r.postageClass,
        orderDate: r.batchOrder.createdAt.toISOString(),
        subtotalPence: r.priceMinor,
      });
      await this.prisma.fulfillmentJob.update({
        where: { id: job.id },
        data: {
          clickAndDropOrderId: result.orderIdentifier,
          clickAndDropError: null,
          clickAndDropImportedAt: new Date(),
        },
      });
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Click & Drop import failed";
      this.logger.error(`Click & Drop import failed for job ${job.id}: ${message}`);
      await this.prisma.fulfillmentJob
        .update({ where: { id: job.id }, data: { clickAndDropError: message.slice(0, 500) } })
        .catch(() => {
          /* recording the error is best-effort */
        });
      return message;
    }
  }
}
