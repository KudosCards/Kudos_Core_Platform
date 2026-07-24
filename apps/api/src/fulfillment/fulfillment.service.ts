import { ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FulfillmentJobStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { EnvConfig } from "../config/env.schema";
import { EMAIL_CLIENT, type EmailClient } from "../email/email.client";
import { BRAND, escapeHtml, renderBrandedEmail } from "../email/email-layout";
import type { Paginated } from "../common/paginated";
import { parsePage, parsePerPage } from "../common/pagination";
import type { ListFulfillmentQueryDto } from "./dto/list-fulfillment-query.dto";
import type { TransitionFulfillmentDto, TransitionableStatus } from "./dto/transition-fulfillment.dto";
import type { BulkTransitionFulfillmentDto } from "./dto/bulk-transition-fulfillment.dto";
import type { ExportAddressesDto } from "./dto/export-addresses.dto";

/**
 * The queue *overview* — deliberately withholds the street address
 * (shippingAddressLine1/2). An operator can triage and plan a print run from
 * name + occasion + design + postage + city/postcode + dispatch date without
 * every child's full home address sitting on one cross-account screen. The
 * full address is revealed only via the audited export endpoint (see
 * exportAddresses) or a single card's detail view. Data minimisation — the
 * GDPR principle, not just accountability.
 */
const QUEUE_SELECT = {
  id: true,
  status: true,
  assignedToUserId: true,
  printedAt: true,
  postedAt: true,
  deliveredAt: true,
  trackingReference: true,
  createdAt: true,
  orderRecipient: {
    select: {
      id: true,
      batchOrderId: true,
      shippingAddressCity: true,
      shippingAddressPostcode: true,
      dispatchOption: true,
      postageClass: true,
      recipient: { select: { firstName: true, lastName: true } },
      savedDesign: { select: { id: true, name: true } },
      occasion: { select: { type: true, occasionDate: true, dispatchDate: true } },
      batchOrder: { select: { accountId: true } },
    },
  },
} satisfies Prisma.FulfillmentJobSelect;

/** The full single-card detail, including the street address needed to
 * actually produce and label a card. Every read of this is audited. */
const DETAIL_SELECT = {
  ...QUEUE_SELECT,
  orderRecipient: {
    select: {
      ...QUEUE_SELECT.orderRecipient.select,
      shippingAddressLine1: true,
      shippingAddressLine2: true,
      shippingAddressCountry: true,
      // customFields + occasion title let the card's {field}/{occasion} tokens
      // resolve in the personalised render (preview + print run).
      recipient: { select: { firstName: true, lastName: true, customFields: true } },
      occasion: { select: { type: true, title: true, occasionDate: true, dispatchDate: true } },
      savedDesign: { select: { id: true, name: true, document: true } },
    },
  },
} satisfies Prisma.FulfillmentJobSelect;

export type FulfillmentQueueJob = Prisma.FulfillmentJobGetPayload<{ select: typeof QUEUE_SELECT }>;
export type FulfillmentJob = Prisma.FulfillmentJobGetPayload<{ select: typeof DETAIL_SELECT }>;

/** One personalised card in a print run — the design + who it's for. The
 * `document` is a design JSON (Prisma.JsonValue); the web types it as a
 * DesignDocument and merges the recipient's name into it before printing. */
export interface PrintRunCard {
  jobId: string;
  recipientFirstName: string;
  recipientLastName: string;
  recipientCustomFields: Prisma.JsonValue;
  occasionType: string | null;
  occasionTitle: string | null;
  occasionDate: Date | null;
  savedDesignName: string;
  document: Prisma.JsonValue;
}

/** One card's dispatch label, returned by the audited export. */
export interface ExportedAddress {
  jobId: string;
  recipientFirstName: string;
  recipientLastName: string;
  shippingAddressLine1: string;
  shippingAddressLine2: string | null;
  shippingAddressCity: string;
  shippingAddressPostcode: string;
  shippingAddressCountry: string;
  postageClass: string;
}

/** Which current statuses permit a transition *to* each target — the inverse
 * of the forward-only state machine (pending → printed → posted → delivered,
 * with failed reachable from any active state). See docs/adr/0010. */
const FROM_STATUSES: Record<TransitionableStatus, FulfillmentJobStatus[]> = {
  printed: ["pending", "in_progress"],
  posted: ["printed"],
  delivered: ["posted"],
  failed: ["pending", "in_progress", "printed", "posted"],
};

export interface BulkTransitionSummary {
  transitioned: number;
  skipped: number;
}

/** One buyer's just-posted cards for a single order, for the dispatch email. */
interface DispatchGroup {
  orderId: string;
  orderNumber: number;
  email: string;
  names: string[];
}

@Injectable()
export class FulfillmentService {
  private readonly logger = new Logger(FulfillmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(EMAIL_CLIENT) private readonly email: EmailClient,
  ) {}

  async list(query: ListFulfillmentQueryDto): Promise<Paginated<FulfillmentQueueJob>> {
    const page = parsePage(query.page);
    const perPage = parsePerPage(query.perPage, 50);
    const where: Prisma.FulfillmentJobWhereInput = {
      status: query.status ?? FulfillmentJobStatus.pending,
    };

    // Two plain queries, not a $transaction — a paginated total needn't be a
    // consistent snapshot with the page, and an explicit read transaction is
    // what misbehaves on a pgBouncer pool (see docs/go-live-runbook.md §1c).
    const items = await this.prisma.fulfillmentJob.findMany({
      where,
      skip: (page - 1) * perPage,
      take: perPage,
      // Oldest first: the queue is worked front-to-back, and dispatchDate
      // is what actually determines send urgency.
      orderBy: [{ createdAt: "asc" }],
      select: QUEUE_SELECT,
    });
    const total = await this.prisma.fulfillmentJob.count({ where });

    return { items, total, page, perPage };
  }

  /** Job counts per status, for the queue's filter chips. */
  async counts(): Promise<Record<FulfillmentJobStatus, number>> {
    const grouped = await this.prisma.fulfillmentJob.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    const result: Record<FulfillmentJobStatus, number> = {
      pending: 0,
      in_progress: 0,
      printed: 0,
      posted: 0,
      delivered: 0,
      returned_to_sender: 0,
      failed: 0,
    };
    for (const row of grouped) {
      result[row.status] = row._count._all;
    }
    return result;
  }

  async findOne(actorUserId: string, id: string): Promise<FulfillmentJob> {
    const job = await this.prisma.fulfillmentJob.findUnique({
      where: { id },
      select: DETAIL_SELECT,
    });
    if (!job) {
      throw new NotFoundException("Fulfillment job not found");
    }
    // Ops viewing a card's full detail is access to a child's name + home
    // address — exactly the recipient-PII access the audit trail exists for.
    await this.audit.record({
      accountId: job.orderRecipient.batchOrder.accountId,
      actorUserId,
      action: "fulfillment_view",
      targetType: "FulfillmentJob",
      targetId: id,
    });
    return job;
  }

  /** Optional "I'm working on this" assignment: pending → in_progress. */
  async claim(actorUserId: string, id: string): Promise<FulfillmentQueueJob> {
    const { count } = await this.prisma.fulfillmentJob.updateMany({
      where: { id, status: "pending" },
      data: { status: "in_progress", assignedToUserId: actorUserId },
    });
    if (count === 0) {
      const existing = await this.prisma.fulfillmentJob.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException("Fulfillment job not found");
      }
      throw new ConflictException(`Job is "${existing.status}", not claimable`);
    }
    // Returns the queue view (no street address) — a status change shouldn't
    // leak the full address back; that only comes via the audited paths.
    return this.prisma.fulfillmentJob.findUniqueOrThrow({
      where: { id },
      select: QUEUE_SELECT,
    });
  }

  async transition(
    actorUserId: string,
    id: string,
    dto: TransitionFulfillmentDto,
  ): Promise<FulfillmentQueueJob> {
    await this.prisma.$transaction(async (tx) => {
      const applied = await this.applyTransition(tx, actorUserId, id, dto.toStatus, {
        trackingReference: dto.trackingReference,
        failureReason: dto.failureReason,
      });
      if (!applied) {
        const existing = await tx.fulfillmentJob.findUnique({ where: { id } });
        if (!existing) {
          throw new NotFoundException("Fulfillment job not found");
        }
        throw new ConflictException(
          `Job is "${existing.status}" — cannot move to "${dto.toStatus}"`,
        );
      }
    });
    // After commit, best-effort: a card just posted → tell the buyer it's on
    // its way. A send failure must not undo the (already committed) dispatch.
    if (dto.toStatus === "posted") {
      await this.notifyDispatched([id]);
    }
    return this.prisma.fulfillmentJob.findUniqueOrThrow({
      where: { id },
      select: QUEUE_SELECT,
    });
  }

  /**
   * Returns full dispatch addresses for a set of jobs — the print-run export.
   * This is the deliberate, audited moment full home addresses are revealed:
   * one audit row per card, committed in the same transaction as the read, so
   * the trail can't be dodged by reading without recording. Data comes back
   * only if every audit row is written.
   */
  async exportAddresses(actorUserId: string, dto: ExportAddressesDto): Promise<ExportedAddress[]> {
    return this.prisma.$transaction(async (tx) => {
      const jobs = await tx.fulfillmentJob.findMany({
        where: { id: { in: dto.jobIds } },
        select: DETAIL_SELECT,
      });

      for (const job of jobs) {
        await this.audit.record(
          {
            accountId: job.orderRecipient.batchOrder.accountId,
            actorUserId,
            action: "fulfillment_address_export",
            targetType: "FulfillmentJob",
            targetId: job.id,
          },
          tx,
        );
      }

      return jobs.map((job) => {
        const r = job.orderRecipient;
        return {
          jobId: job.id,
          recipientFirstName: r.recipient.firstName,
          recipientLastName: r.recipient.lastName,
          shippingAddressLine1: r.shippingAddressLine1,
          shippingAddressLine2: r.shippingAddressLine2,
          shippingAddressCity: r.shippingAddressCity,
          shippingAddressPostcode: r.shippingAddressPostcode,
          shippingAddressCountry: r.shippingAddressCountry,
          postageClass: r.postageClass,
        };
      });
    });
  }

  /**
   * The personalised card faces for a print run — each selected job's design
   * document plus the recipient it prints for, so the operator can produce one
   * PDF of the whole run with names already merged. Audited per card in the same
   * transaction as the read, exactly like the address export (this reveals the
   * recipient's name against a specific card). See docs/adr/0032.
   */
  async printRun(actorUserId: string, dto: ExportAddressesDto): Promise<PrintRunCard[]> {
    return this.prisma.$transaction(async (tx) => {
      const jobs = await tx.fulfillmentJob.findMany({
        where: { id: { in: dto.jobIds } },
        select: DETAIL_SELECT,
      });

      for (const job of jobs) {
        await this.audit.record(
          {
            accountId: job.orderRecipient.batchOrder.accountId,
            actorUserId,
            action: "fulfillment_print_run",
            targetType: "FulfillmentJob",
            targetId: job.id,
          },
          tx,
        );
      }

      return jobs.map((job) => ({
        jobId: job.id,
        recipientFirstName: job.orderRecipient.recipient.firstName,
        recipientLastName: job.orderRecipient.recipient.lastName,
        recipientCustomFields: job.orderRecipient.recipient.customFields,
        occasionType: job.orderRecipient.occasion?.type ?? null,
        occasionTitle: job.orderRecipient.occasion?.title ?? null,
        occasionDate: job.orderRecipient.occasion?.occasionDate ?? null,
        savedDesignName: job.orderRecipient.savedDesign.name,
        document: job.orderRecipient.savedDesign.document,
      }));
    });
  }

  /** One transition applied across a print/post run. Jobs not in a valid
   * source state are skipped (not an error) so a bulk action over a mixed
   * selection does as much as it validly can. */
  async bulkTransition(
    actorUserId: string,
    dto: BulkTransitionFulfillmentDto,
  ): Promise<BulkTransitionSummary> {
    const postedIds: string[] = [];
    const summary = await this.prisma.$transaction(async (tx) => {
      let transitioned = 0;
      for (const id of dto.jobIds) {
        const applied = await this.applyTransition(tx, actorUserId, id, dto.toStatus, {
          trackingReference: dto.trackingReference,
        });
        if (applied) {
          transitioned += 1;
          if (dto.toStatus === "posted") postedIds.push(id);
        }
      }
      return { transitioned, skipped: dto.jobIds.length - transitioned };
    });
    // After commit, best-effort: notify each buyer once per order (grouped), so
    // a bulk post-run doesn't send one email per card.
    await this.notifyDispatched(postedIds);
    return summary;
  }

  /** After cards are marked posted, email each buyer that their card(s) are on
   * the way. Grouped by order so a bulk post-run sends one email per order, not
   * one per card. Fully best-effort — a send failure never rolls back the
   * (already committed) dispatch. See docs/adr/0025. */
  private async notifyDispatched(jobIds: string[]): Promise<void> {
    if (jobIds.length === 0) return;
    let groups: DispatchGroup[];
    try {
      const jobs = await this.prisma.fulfillmentJob.findMany({
        where: { id: { in: jobIds } },
        select: {
          orderRecipient: {
            select: {
              recipient: { select: { firstName: true, lastName: true } },
              batchOrder: {
                select: {
                  id: true,
                  orderNumber: true,
                  account: { select: { contactEmail: true } },
                },
              },
            },
          },
        },
      });

      const byOrder = new Map<string, DispatchGroup>();
      for (const job of jobs) {
        const or = job.orderRecipient;
        const email = or.batchOrder.account.contactEmail;
        if (!email) continue; // no contact email → nowhere to send (rare)
        const group = byOrder.get(or.batchOrder.id) ?? {
          orderId: or.batchOrder.id,
          orderNumber: or.batchOrder.orderNumber,
          email,
          names: [],
        };
        group.names.push(`${or.recipient.firstName} ${or.recipient.lastName}`);
        byOrder.set(or.batchOrder.id, group);
      }
      groups = [...byOrder.values()];
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Dispatch notification lookup for [${jobIds.join(", ")}] failed: ${reason}`);
      return;
    }

    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    for (const group of groups) {
      // Per-order try/catch: one buyer's send failing must not skip the rest.
      try {
        await this.sendDispatchNotification(webAppUrl, group);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Dispatch email for order ${group.orderId} failed: ${reason}`);
      }
    }
  }

  private async sendDispatchNotification(webAppUrl: string, group: DispatchGroup): Promise<void> {
    const orderRef = `ORD-${group.orderNumber}`;
    const orderUrl = `${webAppUrl}/orders/${group.orderId}`;
    const count = group.names.length;
    const cards = count === 1 ? "Your card is" : "Your cards are";
    const list = group.names
      .map((name) => `<li style="margin-bottom:4px">${escapeHtml(name)}</li>`)
      .join("");

    await this.email.sendTransactional({
      to: group.email,
      subject:
        count === 1 ? `Your card has been posted (${orderRef})` : `Your cards have been posted (${orderRef})`,
      // A Brevo template (if configured) is used; otherwise the HTML below.
      // Template params, for reference: {{ params.orderNumber }},
      // {{ params.cardCount }}, {{ params.recipientNames }} ([name] to loop),
      // {{ params.orderUrl }}.
      templateId: this.config.get("BREVO_DISPATCH_TEMPLATE_ID", { infer: true }),
      params: {
        orderNumber: orderRef,
        cardCount: count,
        recipientNames: group.names,
        orderUrl,
      },
      html: renderBrandedEmail({
        webAppUrl,
        preheader: `${cards} on the way — posted today.`,
        heading: count === 1 ? "Your card is on its way ✉️" : "Your cards are on their way ✉️",
        bodyHtml: `
          <p style="margin:0 0 16px">Good news — we've posted ${
            count === 1 ? "your card" : `${count} cards`
          } from order <strong>${orderRef}</strong>. ${
            count === 1 ? "It's" : "They're"
          } now on the way in the post.</p>
          <ul style="margin:0;padding-left:18px;color:${BRAND.ink}">${list}</ul>`,
        cta: { url: orderUrl, label: "View your order" },
      }),
    });
  }

  /**
   * Atomically moves one job to `toStatus` (status-guarded, so a concurrent
   * transition can't double-apply) and propagates the change down to the
   * OrderRecipient, its Occasion, and up to the BatchOrder. Returns false if
   * the job wasn't in a valid source state (caller decides: throw vs skip).
   */
  private async applyTransition(
    tx: Prisma.TransactionClient,
    actorUserId: string,
    id: string,
    toStatus: TransitionableStatus,
    opts: { trackingReference?: string; failureReason?: string },
  ): Promise<boolean> {
    const now = new Date();
    const jobData: Prisma.FulfillmentJobUpdateManyMutationInput = { status: toStatus };
    if (toStatus === "printed") jobData.printedAt = now;
    if (toStatus === "posted") {
      jobData.postedAt = now;
      if (opts.trackingReference) jobData.trackingReference = opts.trackingReference;
    }
    if (toStatus === "delivered") jobData.deliveredAt = now;

    const { count } = await tx.fulfillmentJob.updateMany({
      where: { id, status: { in: FROM_STATUSES[toStatus] } },
      data: jobData,
    });
    if (count === 0) {
      return false;
    }

    const job = await tx.fulfillmentJob.findUniqueOrThrow({
      where: { id },
      select: {
        orderRecipient: {
          select: {
            id: true,
            occasionId: true,
            batchOrderId: true,
            batchOrder: { select: { accountId: true } },
          },
        },
      },
    });
    const { orderRecipient } = job;

    // failed leaves the OrderRecipient/Occasion where they are (the card
    // couldn't be produced; a human decides what to do) — only the job and
    // the audit trail record it.
    if (toStatus !== "failed") {
      await tx.orderRecipient.update({
        where: { id: orderRecipient.id },
        data: { status: toStatus },
      });
      if (orderRecipient.occasionId) {
        await tx.occasion.update({
          where: { id: orderRecipient.occasionId },
          data: { status: toStatus },
        });
      }

      // The order enters "fulfilling" the moment its first card is printed,
      // and "completed" once every non-cancelled card is delivered.
      await tx.batchOrder.updateMany({
        where: { id: orderRecipient.batchOrderId, status: "paid" },
        data: { status: "fulfilling" },
      });
      if (toStatus === "delivered") {
        const outstanding = await tx.orderRecipient.count({
          where: {
            batchOrderId: orderRecipient.batchOrderId,
            status: { notIn: ["delivered", "cancelled"] },
          },
        });
        if (outstanding === 0) {
          await tx.batchOrder.updateMany({
            where: { id: orderRecipient.batchOrderId, status: "fulfilling" },
            data: { status: "completed" },
          });
        }
      }
    }

    await this.audit.record(
      {
        accountId: orderRecipient.batchOrder.accountId,
        actorUserId,
        action: `fulfillment_${toStatus}`,
        targetType: "FulfillmentJob",
        targetId: id,
        metadata: {
          ...(opts.trackingReference && { trackingReference: opts.trackingReference }),
          ...(opts.failureReason && { failureReason: opts.failureReason }),
        },
      },
      tx,
    );
    return true;
  }
}
