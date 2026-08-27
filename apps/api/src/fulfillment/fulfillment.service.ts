import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FulfillmentJobStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { EnvConfig } from "../config/env.schema";
import { EMAIL_CLIENT, type EmailClient } from "../email/email.client";
import { BRAND, escapeHtml, renderBrandedEmail } from "../email/email-layout";
import { ROYAL_MAIL_CLIENT } from "../shipping/royal-mail-client.provider";
import { royalMailTrackingUrl, type RoyalMailClient } from "../shipping/royal-mail-client";
import { ClickAndDropService } from "../shipping/click-and-drop.service";
import { DispatchConfigService } from "../dispatch/dispatch-config.service";
import type { Paginated } from "../common/paginated";
import { parsePage, parsePerPage } from "../common/pagination";
import { addWorkingDays, isoDay, startOfUtcDay } from "@kudos/shared-types";
import type { FulfillmentCalendar, FulfillmentCalendarDay } from "@kudos/shared-types";
import type { ListFulfillmentQueryDto } from "./dto/list-fulfillment-query.dto";
import { dueCutoffs, isoDayToUtc, workingDaysUntilDue } from "./fulfillment-due.util";
import type {
  TransitionFulfillmentDto,
  TransitionableStatus,
} from "./dto/transition-fulfillment.dto";
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
  labelUrl: true,
  clickAndDropOrderId: true,
  clickAndDropError: true,
  dueDate: true,
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
      // This card's own QR slug (minted at settlement). The print run encodes it
      // into the real /r/<slug> QR so a printed card scans to its message page —
      // without it the QR element renders as an empty placeholder box.
      messagePageLink: { select: { slug: true } },
    },
  },
} satisfies Prisma.FulfillmentJobSelect;

export type FulfillmentQueueJob = Prisma.FulfillmentJobGetPayload<{ select: typeof QUEUE_SELECT }>;
export type FulfillmentJob = Prisma.FulfillmentJobGetPayload<{ select: typeof DETAIL_SELECT }>;

/** A queue row plus its server-computed urgency: working days until the card
 * must post (negative = overdue, 0 = today, null = no dated deadline). The web
 * renders the badge from this rather than recomputing the UK holiday calendar. */
export type FulfillmentQueueRow = FulfillmentQueueJob & { workingDaysUntilDue: number | null };

/** Queue counts for the ops filters: per-status (all statuses) plus the due-date
 * urgency buckets within the actionable `pending` queue. See ADR 0108. */
export interface FulfillmentCounts {
  status: Record<FulfillmentJobStatus, number>;
  due: { overdue: number; today: number; dueSoon: number; upcoming: number; noDate: number };
  clickAndDropErrors: number;
}

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
  /** This card's QR slug, or null if none was minted. The web builds the
   * absolute /r/<slug> link from it and renders the real QR onto the print. */
  messagePageSlug: string | null;
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

/** Statuses whose posting deadline is still actionable — a card not yet posted.
 * The dispatch calendar and its "overdue" carry-over count only these. */
const OPEN_STATUSES: FulfillmentJobStatus[] = ["pending", "in_progress", "printed"];

/** How many of the most-urgent must-ship cards to return with the summary —
 * enough for the reminder digest + dashboard preview without unbounding it. */
const MUST_SHIP_LIMIT = 50;

/** One card on the must-ship watch-list: enough to identify and prioritise it
 * (name + city, exactly what the queue view already exposes — no street
 * address). See ADR 0115. */
const MUST_SHIP_SELECT = {
  id: true,
  status: true,
  dueDate: true,
  orderRecipient: {
    select: {
      shippingAddressCity: true,
      shippingAddressPostcode: true,
      recipient: { select: { firstName: true, lastName: true } },
      batchOrder: { select: { orderNumber: true } },
    },
  },
} satisfies Prisma.FulfillmentJobSelect;

type MustShipRow = Prisma.FulfillmentJobGetPayload<{ select: typeof MUST_SHIP_SELECT }>;

/** One must-ship card, flattened for the ops surfaces. */
export interface MustShipCard {
  jobId: string;
  orderNumber: number;
  recipientName: string;
  city: string;
  postcode: string;
  dueDate: Date;
  /** Working days until it must post: negative = overdue, 0 = due today. */
  workingDaysUntilDue: number;
  status: FulfillmentJobStatus;
}

/**
 * The internal "post-by" watch-list — the single source of truth behind the
 * send-by-5 SLA (ADR 0115). Counts every open (not-yet-posted) card whose
 * dispatch deadline is overdue, today, or within the send-by-5 window, and
 * returns the most urgent ones. One method so the ops must-ship band, the
 * shell banner, the daily reminder email and the notification centre never
 * disagree.
 */
export interface MustShipSummary {
  overdue: number;
  today: number;
  dueSoon: number;
  total: number;
  cards: MustShipCard[];
}

/** How wide a dispatch-calendar window the API will scan in one request. */
const MAX_CALENDAR_DAYS = 92;

export interface BulkTransitionSummary {
  transitioned: number;
  skipped: number;
}

/** The outcome of one delivery-poll sweep, for logging + the ops on-demand run. */
export interface DeliveryPollResult {
  /** Posted-with-tracking jobs looked up this sweep. */
  checked: number;
  /** How many the carrier reported delivered and we advanced to `delivered`. */
  delivered: number;
  /** Tracking lookups that errored (transport/HTTP) and were skipped this sweep. */
  failed: number;
}

/** The audit/actor id recorded when the delivery poll registers a delivery —
 * no operator clicked, the carrier's tracking did. Mirrors the other
 * `system:*` actors (auto-send, stripe-webhook). */
const DELIVERY_POLL_ACTOR = "system:delivery-poll";

/** Cap one sweep so a large `posted` backlog can't fan out into an unbounded
 * run of carrier calls; the oldest-posted are checked first and the rest roll
 * to the next sweep. */
const DELIVERY_POLL_BATCH = 200;

/** The outcome of one estimated-arrival sweep, for logging + the ops on-demand run. */
export interface ArrivalSweepResult {
  /** Recently-posted cards examined this sweep. */
  checked: number;
  /** How many reached their estimated arrival → marked delivered + buyer emailed. */
  notified: number;
}

/** Actor recorded when the arrival sweep marks a card delivered (estimated) — no
 * operator and no carrier event; the posting-date estimate did. Mirrors the
 * other `system:*` actors. See ADR 0124. */
const ARRIVAL_ACTOR = "system:arrival-estimate";

/** One sweep's cap on cards to examine, matching the delivery poll's bounding. */
const ARRIVAL_SWEEP_BATCH = 500;

/** One buyer's just-posted cards for a single order, for the dispatch email. */
interface DispatchGroup {
  orderId: string;
  orderNumber: number;
  email: string;
  cards: { name: string; trackingReference: string | null }[];
}

@Injectable()
export class FulfillmentService {
  private readonly logger = new Logger(FulfillmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(EMAIL_CLIENT) private readonly email: EmailClient,
    @Inject(ROYAL_MAIL_CLIENT) private readonly royalMail: RoyalMailClient,
    private readonly clickAndDrop: ClickAndDropService,
    private readonly dispatchConfig: DispatchConfigService,
  ) {}

  /** Whether Click & Drop order-import is wired (drives the ops UI). */
  clickAndDropEnabled(): boolean {
    return this.clickAndDrop.enabled();
  }

  /** Ops diagnostic: fire one real read-only Click & Drop call and return the raw
   * status + body, so a bad key or base URL is diagnosable without the sweep. */
  testClickAndDrop() {
    return this.clickAndDrop.testConnection();
  }

  /** Ops readout: how many cards have imported into Click & Drop vs are errored
   * or still awaiting a push, plus a few sampled references to confirm in the
   * dashboard. See ADR 0114. */
  clickAndDropImportStatus() {
    return this.clickAndDrop.importStatus();
  }

  /** Attach the server-computed urgency (working days until due) to a queue row,
   * so every path that returns a row — the list and each single-row action the
   * web patches in place — carries the same shape. */
  private enrichRow(job: FulfillmentQueueJob, now: Date = new Date()): FulfillmentQueueRow {
    return { ...job, workingDaysUntilDue: workingDaysUntilDue(job.dueDate, now) };
  }

  /** Retry importing a single card into Click & Drop (an ops action), returning
   * the refreshed queue row so the UI can patch it in place. */
  async retryClickAndDrop(id: string): Promise<FulfillmentQueueRow> {
    await this.clickAndDrop.retryJob(id);
    const job = await this.prisma.fulfillmentJob.findUniqueOrThrow({
      where: { id },
      select: QUEUE_SELECT,
    });
    return this.enrichRow(job);
  }

  /** Whether Royal Mail shipping automation is wired (drives the ops UI). */
  shippingAutomationEnabled(): boolean {
    return this.royalMail.enabled;
  }

  /**
   * Auto-dispatch a printed card via Royal Mail: create the shipment (buys
   * postage + allocates a tracking number + label), then move the job to
   * `posted` with the tracking reference and label stored. The buyer's dispatch
   * email (fired on `posted`) then carries the tracking link.
   *
   * The Shipping API call happens BEFORE the DB transition and outside any
   * transaction — a real network call must never hold a DB transaction open —
   * and only a success transitions the job. If the transition then finds the
   * job already moved on (double-click), we've created a shipment we didn't
   * record; that's surfaced as a conflict for the operator to reconcile rather
   * than silently dropped.
   */
  async dispatch(actorUserId: string, id: string): Promise<FulfillmentQueueRow> {
    if (!this.royalMail.enabled) {
      throw new BadRequestException(
        "Royal Mail shipping isn't configured — mark the card posted manually instead.",
      );
    }
    const job = await this.prisma.fulfillmentJob.findUnique({
      where: { id },
      select: DETAIL_SELECT,
    });
    if (!job) {
      throw new NotFoundException("Fulfillment job not found");
    }
    if (!FROM_STATUSES.posted.includes(job.status)) {
      throw new ConflictException(`Job is "${job.status}" — print it before dispatching`);
    }

    const r = job.orderRecipient;
    const shipment = await this.royalMail.createShipment({
      orderReference: `ORD-${await this.orderNumberFor(r.batchOrderId)}`,
      recipientName: `${r.recipient.firstName} ${r.recipient.lastName}`.trim(),
      addressLine1: r.shippingAddressLine1,
      addressLine2: r.shippingAddressLine2,
      city: r.shippingAddressCity,
      postcode: r.shippingAddressPostcode,
      country: r.shippingAddressCountry,
      postageClass: r.postageClass,
    });

    await this.prisma.$transaction(async (tx) => {
      const applied = await this.applyTransition(tx, actorUserId, id, "posted", {
        trackingReference: shipment.trackingNumber,
        labelUrl: shipment.labelUrl,
      });
      if (!applied) {
        throw new ConflictException(
          `Royal Mail shipment ${shipment.trackingNumber} was created, but the job is no longer printable — reconcile manually`,
        );
      }
    });
    await this.notifyDispatched([id]);
    const refreshed = await this.prisma.fulfillmentJob.findUniqueOrThrow({
      where: { id },
      select: QUEUE_SELECT,
    });
    return this.enrichRow(refreshed);
  }

  /** Bulk auto-dispatch: dispatch each printed job in turn. A per-job failure
   * (e.g. a Royal Mail error on one address) is recorded and skipped so the
   * rest of the run still goes; the summary reports how many shipped. */
  async dispatchMany(
    actorUserId: string,
    jobIds: string[],
  ): Promise<{ dispatched: number; failed: number }> {
    if (!this.royalMail.enabled) {
      throw new BadRequestException(
        "Royal Mail shipping isn't configured — mark cards posted manually instead.",
      );
    }
    let dispatched = 0;
    let failed = 0;
    for (const id of jobIds) {
      try {
        await this.dispatch(actorUserId, id);
        dispatched += 1;
      } catch (error) {
        failed += 1;
        const reason = error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Royal Mail dispatch for job ${id} failed: ${reason}`);
      }
    }
    return { dispatched, failed };
  }

  /**
   * Auto-register delivery from Royal Mail tracking: sweep the `posted` cards
   * that carry a tracking reference, ask the carrier each one's state, and
   * advance any it reports delivered to `delivered` — stamping the carrier's own
   * delivery time when known, through the same audited state machine an operator
   * would (so `deliveredAt`, the OrderRecipient/Occasion cascade and the order's
   * `completed` roll-up all happen exactly once). A per-card tracking error is
   * logged and skipped so one bad lookup never stops the sweep; the card stays
   * `posted` and is retried next run. Manual "Mark delivered" remains the
   * fallback. No-ops when shipping automation is off. See ADR 0121.
   */
  async pollCarrierDeliveries(): Promise<DeliveryPollResult> {
    if (!this.royalMail.enabled) {
      return { checked: 0, delivered: 0, failed: 0 };
    }
    const jobs = await this.prisma.fulfillmentJob.findMany({
      where: { status: "posted", trackingReference: { not: null } },
      select: { id: true, trackingReference: true },
      orderBy: { postedAt: "asc" },
      take: DELIVERY_POLL_BATCH,
    });

    let delivered = 0;
    let failed = 0;
    for (const job of jobs) {
      const trackingReference = job.trackingReference;
      if (!trackingReference) continue; // narrows the type; the where already excludes null
      try {
        const result = await this.royalMail.getTrackingStatus(trackingReference);
        if (result.status !== "delivered") continue;
        const applied = await this.prisma.$transaction((tx) =>
          this.applyTransition(tx, DELIVERY_POLL_ACTOR, job.id, "delivered", {
            deliveredAt: result.deliveredAt ?? undefined,
          }),
        );
        if (applied) delivered += 1;
      } catch (error) {
        failed += 1;
        const reason = error instanceof Error ? error.message : "Unknown error";
        this.logger.error(
          `Delivery tracking for job ${job.id} (${trackingReference}) failed: ${reason}`,
        );
      }
    }
    return { checked: jobs.length, delivered, failed };
  }

  /**
   * The estimated-arrival sweep (ADR 0124). Our cards go on ordinary stamps,
   * which Royal Mail does not track — so we never observe a real delivery. This
   * estimates arrival from each posted card's `postedAt` + its postage class's
   * expected transit (working days, UK holiday-aware, from config) and, once that
   * day has passed, marks the card **delivered (estimated)** — closing the order
   * — and emails the buyer an honest "should have arrived" note.
   *
   * Bounded to cards posted within the configured recency window, so enabling it
   * never emails or auto-completes a historical `posted` backlog in one go.
   * Idempotent for free: a card that transitions leaves the `posted` set, so a
   * later sweep can't pick it up again (the same guard the manual/delivery-poll
   * paths rely on).
   */
  async notifyEstimatedArrivals(now: Date = new Date()): Promise<ArrivalSweepResult> {
    const firstDays = this.config.get("ARRIVAL_FIRST_CLASS_WORKING_DAYS", { infer: true });
    const secondDays = this.config.get("ARRIVAL_SECOND_CLASS_WORKING_DAYS", { infer: true });
    const maxAgeDays = this.config.get("ARRIVAL_MAX_POSTED_AGE_DAYS", { infer: true });
    const today = startOfUtcDay(now);
    const earliestPosted = new Date(today);
    earliestPosted.setUTCDate(earliestPosted.getUTCDate() - maxAgeDays);

    const candidates = await this.prisma.fulfillmentJob.findMany({
      where: { status: "posted", postedAt: { gte: earliestPosted, lte: now } },
      select: {
        id: true,
        postedAt: true,
        orderRecipient: { select: { postageClass: true } },
      },
      orderBy: { postedAt: "asc" },
      take: ARRIVAL_SWEEP_BATCH,
    });

    const arrivedIds: string[] = [];
    for (const job of candidates) {
      if (!job.postedAt) continue; // status posted implies postedAt, but narrow the type
      const transit = job.orderRecipient.postageClass === "second_class" ? secondDays : firstDays;
      const estimatedArrival = addWorkingDays(startOfUtcDay(job.postedAt), transit);
      // Not due to have arrived yet — leave it for a later sweep.
      if (estimatedArrival.getTime() > today.getTime()) continue;
      const applied = await this.prisma.$transaction((tx) =>
        this.applyTransition(tx, ARRIVAL_ACTOR, job.id, "delivered", {
          deliveredAt: estimatedArrival,
        }),
      );
      if (applied) arrivedIds.push(job.id);
    }

    await this.notifyArrived(arrivedIds);
    return { checked: candidates.length, notified: arrivedIds.length };
  }

  private async orderNumberFor(batchOrderId: string): Promise<number> {
    const order = await this.prisma.batchOrder.findUniqueOrThrow({
      where: { id: batchOrderId },
      select: { orderNumber: true },
    });
    return order.orderNumber;
  }

  async list(query: ListFulfillmentQueryDto): Promise<Paginated<FulfillmentQueueRow>> {
    const page = parsePage(query.page);
    const perPage = parsePerPage(query.perPage, 50);
    const now = new Date();
    const { today, dueSoon } = dueCutoffs(now);

    const where: Prisma.FulfillmentJobWhereInput = {};
    if (query.status) {
      where.status = query.status;
    } else if (query.dueOn) {
      // A calendar drill-in with no explicit status shows every still-open card
      // due that day (pending / in progress / printed), so the queue count
      // matches the calendar badge's open-status total rather than pending
      // alone. An explicit status tab still narrows within the day. See ADR 0110.
      where.status = { in: OPEN_STATUSES };
    } else {
      where.status = FulfillmentJobStatus.pending;
    }
    if (query.dueOn) {
      // The dispatch-calendar drill-in: exactly one deadline day. Takes
      // precedence over the `due` bucket. See ADR 0110.
      where.dueDate = { equals: isoDayToUtc(query.dueOn) };
    } else {
      const dueFilter = this.dueWhere(query.due, today, dueSoon);
      if (dueFilter !== undefined) where.dueDate = dueFilter;
    }

    // Default: soonest deadline first. Postgres sorts NULLs last on ASC, so
    // undated cards (no occasion) naturally trail the dated, urgency-ordered
    // ones; createdAt breaks ties. `sort=created_at` keeps the old arrival order.
    const orderBy: Prisma.FulfillmentJobOrderByWithRelationInput[] =
      query.sort === "created_at"
        ? [{ createdAt: "asc" }]
        : [{ dueDate: "asc" }, { createdAt: "asc" }];

    // Two plain queries, not a $transaction — a paginated total needn't be a
    // consistent snapshot with the page, and an explicit read transaction is
    // what misbehaves on a pgBouncer pool (see docs/go-live-runbook.md §1c).
    const items = await this.prisma.fulfillmentJob.findMany({
      where,
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy,
      select: QUEUE_SELECT,
    });
    const total = await this.prisma.fulfillmentJob.count({ where });

    return { items: items.map((job) => this.enrichRow(job, now)), total, page, perPage };
  }

  /** Translate a due-date urgency filter into a `dueDate` where-clause against
   * the precomputed calendar cutoffs. `undefined` means no constraint (all);
   * `null` means "no dated deadline" (dueDate IS NULL). See ADR 0108. */
  private dueWhere(
    due: ListFulfillmentQueryDto["due"],
    today: Date,
    dueSoon: Date,
  ): Prisma.DateTimeNullableFilter | Date | null | undefined {
    switch (due) {
      case "overdue":
        return { lt: today };
      case "today":
        return { equals: today };
      case "due_soon":
        return { gt: today, lte: dueSoon };
      case "upcoming":
        return { gt: dueSoon };
      case "no_date":
        return null;
      default:
        return undefined; // "all" or unset
    }
  }

  /** Queue counts for the ops filters: per-status across all statuses, plus the
   * due-date urgency buckets within the actionable `pending` queue. The buckets
   * come from one filtered-aggregate round-trip against the same cutoffs the
   * list uses, so the chip totals and the filtered lists always agree. */
  async counts(): Promise<FulfillmentCounts> {
    const grouped = await this.prisma.fulfillmentJob.groupBy({
      by: ["status"],
      _count: { _all: true },
    });
    const status: Record<FulfillmentJobStatus, number> = {
      pending: 0,
      in_progress: 0,
      printed: 0,
      posted: 0,
      delivered: 0,
      returned_to_sender: 0,
      failed: 0,
    };
    for (const row of grouped) {
      status[row.status] = row._count._all;
    }

    const { today, dueSoon } = dueCutoffs();
    const todayIso = isoDay(today);
    const dueSoonIso = isoDay(dueSoon);
    const rows = await this.prisma.$queryRaw<
      Array<{ overdue: number; today: number; due_soon: number; upcoming: number; no_date: number }>
    >(Prisma.sql`
      SELECT
        count(*) FILTER (WHERE due_date < ${todayIso}::date)::int AS overdue,
        count(*) FILTER (WHERE due_date = ${todayIso}::date)::int AS today,
        count(*) FILTER (WHERE due_date > ${todayIso}::date AND due_date <= ${dueSoonIso}::date)::int AS due_soon,
        count(*) FILTER (WHERE due_date > ${dueSoonIso}::date)::int AS upcoming,
        count(*) FILTER (WHERE due_date IS NULL)::int AS no_date
      FROM fulfillment_jobs
      WHERE status::text = 'pending'
    `);
    const due = rows[0];

    // Open cards whose last Click & Drop import failed — an ops attention signal.
    const clickAndDropErrors = await this.prisma.fulfillmentJob.count({
      where: { status: { in: OPEN_STATUSES }, clickAndDropError: { not: null } },
    });

    return {
      status,
      due: {
        overdue: due?.overdue ?? 0,
        today: due?.today ?? 0,
        dueSoon: due?.due_soon ?? 0,
        upcoming: due?.upcoming ?? 0,
        noDate: due?.no_date ?? 0,
      },
      clickAndDropErrors,
    };
  }

  /**
   * The must-ship watch-list for the send-by-5 SLA (ADR 0115): every open
   * (not-yet-posted) card whose dispatch deadline is overdue, today, or within
   * the send-by-5 working-day window, split into those three bands, plus the
   * most urgent cards (soonest deadline first). Spans all open statuses — a
   * `printed`-but-not-posted card past its deadline is still must-ship, unlike
   * the pending-only `counts.due` buckets. Powers the dashboard band, the shell
   * banner, the daily reminder email and the notification centre.
   */
  async mustShip(now: Date = new Date()): Promise<MustShipSummary> {
    // The send-by window is runtime-configurable (default 5 working days), so the
    // must-ship band, banner, and reminder all move together. See ADR 0117.
    const { leadWorkingDays } = await this.dispatchConfig.getReminderConfig();
    const { today, dueSoon } = dueCutoffs(now, leadWorkingDays);
    const openAnd = (dueDate: Prisma.DateTimeNullableFilter): Prisma.FulfillmentJobWhereInput => ({
      status: { in: OPEN_STATUSES },
      dueDate,
    });

    const [overdue, todayCount, dueSoonCount, rows] = await Promise.all([
      this.prisma.fulfillmentJob.count({ where: openAnd({ lt: today }) }),
      this.prisma.fulfillmentJob.count({ where: openAnd({ equals: today }) }),
      this.prisma.fulfillmentJob.count({ where: openAnd({ gt: today, lte: dueSoon }) }),
      this.prisma.fulfillmentJob.findMany({
        // Everything due on or before the send-by-5 cutoff (overdue + today +
        // due-soon), soonest-first, bounded.
        where: openAnd({ lte: dueSoon }),
        orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
        take: MUST_SHIP_LIMIT,
        select: MUST_SHIP_SELECT,
      }),
    ]);

    return {
      overdue,
      today: todayCount,
      dueSoon: dueSoonCount,
      total: overdue + todayCount + dueSoonCount,
      cards: rows.map((row) => this.toMustShipCard(row, now)),
    };
  }

  private toMustShipCard(row: MustShipRow, now: Date): MustShipCard {
    const r = row.orderRecipient;
    return {
      jobId: row.id,
      orderNumber: r.batchOrder.orderNumber,
      recipientName: `${r.recipient.firstName} ${r.recipient.lastName}`.trim(),
      city: r.shippingAddressCity,
      postcode: r.shippingAddressPostcode,
      // Only dated, due-now-or-soon cards reach here, so dueDate is non-null.
      dueDate: row.dueDate!,
      workingDaysUntilDue: workingDaysUntilDue(row.dueDate, now) ?? 0,
      status: row.status,
    };
  }

  /**
   * The open posting workload keyed on dispatch deadline, for the dispatch
   * calendar: per-day counts of still-open cards (pending / in progress /
   * printed) due to post within [from, to], plus a single "overdue before this
   * window" count for a carried-in banner. One grouped aggregate + one count —
   * the grid never fetches individual cards. See ADR 0110.
   */
  async calendar(fromIso: string, toIso: string): Promise<FulfillmentCalendar> {
    const from = isoDayToUtc(fromIso);
    const to = isoDayToUtc(toIso);
    if (to.getTime() < from.getTime()) {
      throw new BadRequestException("`to` must be on or after `from`");
    }
    const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (spanDays > MAX_CALENDAR_DAYS) {
      throw new BadRequestException(`Calendar window is capped at ${MAX_CALENDAR_DAYS} days`);
    }

    const grouped = await this.prisma.fulfillmentJob.groupBy({
      by: ["dueDate", "status"],
      where: { status: { in: OPEN_STATUSES }, dueDate: { gte: from, lte: to } },
      _count: { _all: true },
    });

    const byDay = new Map<string, FulfillmentCalendarDay>();
    for (const row of grouped) {
      if (!row.dueDate) continue;
      const day = isoDay(row.dueDate);
      const entry = byDay.get(day) ?? { day, total: 0, pending: 0, inProgress: 0, printed: 0 };
      const count = row._count._all;
      entry.total += count;
      if (row.status === "pending") entry.pending += count;
      else if (row.status === "in_progress") entry.inProgress += count;
      else if (row.status === "printed") entry.printed += count;
      byDay.set(day, entry);
    }
    const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));

    // "Overdue carried in": open cards due before this window that aren't shown
    // in it. Cut off at min(from, today) so browsing a *future* month doesn't
    // count cards that are merely not-yet-due (before the window) as overdue —
    // the banner then always means genuinely overdue, agreeing with the queue's
    // `due=overdue` filter it links to. See ADR 0110.
    const today = startOfUtcDay(new Date());
    const overdueCutoff = from.getTime() < today.getTime() ? from : today;
    const overdueBefore = await this.prisma.fulfillmentJob.count({
      where: { status: { in: OPEN_STATUSES }, dueDate: { lt: overdueCutoff } },
    });

    return { days, overdueBefore };
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
  async claim(actorUserId: string, id: string): Promise<FulfillmentQueueRow> {
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
    const job = await this.prisma.fulfillmentJob.findUniqueOrThrow({
      where: { id },
      select: QUEUE_SELECT,
    });
    return this.enrichRow(job);
  }

  async transition(
    actorUserId: string,
    id: string,
    dto: TransitionFulfillmentDto,
  ): Promise<FulfillmentQueueRow> {
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
    const job = await this.prisma.fulfillmentJob.findUniqueOrThrow({
      where: { id },
      select: QUEUE_SELECT,
    });
    return this.enrichRow(job);
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
        messagePageSlug: job.orderRecipient.messagePageLink?.slug ?? null,
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

  /** Load a set of jobs and fold them into one group per buyer order (name +
   * tracking + contact email), so a bulk action sends one email per order, not
   * one per card. Returns null if the lookup itself fails (caller logs + bails);
   * orders whose account has no contact email are dropped. Shared by the
   * dispatch and arrival notifications. */
  private async groupJobsIntoOrders(jobIds: string[]): Promise<DispatchGroup[] | null> {
    try {
      const jobs = await this.prisma.fulfillmentJob.findMany({
        where: { id: { in: jobIds } },
        select: {
          trackingReference: true,
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
          cards: [],
        };
        group.cards.push({
          name: `${or.recipient.firstName} ${or.recipient.lastName}`,
          trackingReference: job.trackingReference,
        });
        byOrder.set(or.batchOrder.id, group);
      }
      return [...byOrder.values()];
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Notification lookup for [${jobIds.join(", ")}] failed: ${reason}`);
      return null;
    }
  }

  /** After cards are marked posted, email each buyer that their card(s) are on
   * the way. Grouped by order so a bulk post-run sends one email per order, not
   * one per card. Fully best-effort — a send failure never rolls back the
   * (already committed) dispatch. See docs/adr/0025. */
  private async notifyDispatched(jobIds: string[]): Promise<void> {
    if (jobIds.length === 0) return;
    const groups = await this.groupJobsIntoOrders(jobIds);
    if (!groups) return;

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

  /** After the arrival sweep marks cards delivered (estimated), email each buyer
   * that their card(s) should have arrived. Grouped per order, best-effort — a
   * send failure never undoes the (already committed) delivered transition. See
   * ADR 0124. */
  private async notifyArrived(jobIds: string[]): Promise<void> {
    if (jobIds.length === 0) return;
    const groups = await this.groupJobsIntoOrders(jobIds);
    if (!groups) return;

    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    for (const group of groups) {
      try {
        await this.sendArrivalNotification(webAppUrl, group);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Arrival email for order ${group.orderId} failed: ${reason}`);
      }
    }
  }

  private async sendDispatchNotification(webAppUrl: string, group: DispatchGroup): Promise<void> {
    const orderRef = `ORD-${group.orderNumber}`;
    const orderUrl = `${webAppUrl}/orders/${group.orderId}`;
    const count = group.cards.length;
    const cards = count === 1 ? "Your card is" : "Your cards are";
    // Each name, with a "Track" link when the card has a Royal Mail tracking
    // number (auto-dispatched via the Shipping API).
    const list = group.cards
      .map((card) => {
        const track = card.trackingReference
          ? ` — <a href="${royalMailTrackingUrl(card.trackingReference)}" style="color:${
              BRAND.accent
            }">track it</a>`
          : "";
        return `<li style="margin-bottom:4px">${escapeHtml(card.name)}${track}</li>`;
      })
      .join("");

    await this.email.sendTransactional({
      to: group.email,
      subject:
        count === 1
          ? `Your card has been posted (${orderRef})`
          : `Your cards have been posted (${orderRef})`,
      // A Brevo template (if configured) is used; otherwise the HTML below.
      // Template params, for reference: {{ params.orderNumber }},
      // {{ params.cardCount }}, {{ params.recipientNames }} ([name] to loop),
      // {{ params.orderUrl }}.
      templateId: this.config.get("BREVO_DISPATCH_TEMPLATE_ID", { infer: true }),
      params: {
        orderNumber: orderRef,
        cardCount: count,
        recipientNames: group.cards.map((c) => c.name),
        tracking: group.cards
          .filter((c) => c.trackingReference)
          .map((c) => ({ name: c.name, trackingReference: c.trackingReference })),
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
   * The estimated-arrival email. Deliberately honest: standard letter post isn't
   * tracked, so we say the card *should have* arrived based on the posting date
   * and Royal Mail's usual times — never that it *was* delivered. No tracking
   * link (there's nothing to track). See ADR 0124.
   */
  private async sendArrivalNotification(webAppUrl: string, group: DispatchGroup): Promise<void> {
    const orderRef = `ORD-${group.orderNumber}`;
    const orderUrl = `${webAppUrl}/orders/${group.orderId}`;
    const count = group.cards.length;
    const list = group.cards
      .map((card) => `<li style="margin-bottom:4px">${escapeHtml(card.name)}</li>`)
      .join("");

    await this.email.sendTransactional({
      to: group.email,
      subject:
        count === 1
          ? `Your card should have arrived (${orderRef})`
          : `Your cards should have arrived (${orderRef})`,
      // Optional Brevo template. Params: {{ params.orderNumber }},
      // {{ params.cardCount }}, {{ params.recipientNames }} ([name] to loop),
      // {{ params.orderUrl }}.
      templateId: this.config.get("BREVO_ARRIVAL_TEMPLATE_ID", { infer: true }),
      params: {
        orderNumber: orderRef,
        cardCount: count,
        recipientNames: group.cards.map((c) => c.name),
        orderUrl,
      },
      html: renderBrandedEmail({
        webAppUrl,
        preheader:
          count === 1 ? "Your card should have arrived." : "Your cards should have arrived.",
        heading:
          count === 1 ? "Your card should have arrived 💌" : "Your cards should have arrived 💌",
        bodyHtml: `
          <p style="margin:0 0 16px">Based on when we posted ${
            count === 1 ? "your card" : `${count} cards`
          } from order <strong>${orderRef}</strong> and Royal Mail's usual delivery times, ${
            count === 1 ? "it" : "they"
          } should have arrived by now — we hope ${
            count === 1 ? "it makes" : "they make"
          } someone's day. ✨</p>
          <ul style="margin:0;padding-left:18px;color:${BRAND.ink}">${list}</ul>
          <p style="margin:16px 0 0;font-size:13px;color:#6b7280">This is an estimate from the posting date — standard letter post isn't tracked, so we can't confirm exact delivery.</p>`,
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
    opts: {
      trackingReference?: string;
      failureReason?: string;
      labelUrl?: string | null;
      /** The carrier's recorded delivery time, when a delivery-registration comes
       * from tracking rather than an operator; falls back to now. */
      deliveredAt?: Date;
    },
  ): Promise<boolean> {
    const now = new Date();
    const jobData: Prisma.FulfillmentJobUpdateManyMutationInput = { status: toStatus };
    if (toStatus === "printed") jobData.printedAt = now;
    if (toStatus === "posted") {
      jobData.postedAt = now;
      if (opts.trackingReference) jobData.trackingReference = opts.trackingReference;
      if (opts.labelUrl) jobData.labelUrl = opts.labelUrl;
    }
    if (toStatus === "delivered") jobData.deliveredAt = opts.deliveredAt ?? now;

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
