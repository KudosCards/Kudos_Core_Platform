import { z } from "zod";
import { ukPostcodeRegex } from "./recipient";
import type { BatchOrderStatus, OrderRecipientStatus } from "./enums";
import {
  batchOrderStatusSchema,
  dispatchOptionSchema,
  occasionTypeSchema,
  orderRecipientStatusSchema,
  paymentMethodSchema,
  postageClassSchema,
} from "./enums";

/**
 * One order representing a whole batch (e.g. "10 birthday cards this week").
 * Replaces the legacy pattern of one WooCommerce cart line per recipient.
 * Mirrors BatchOrdersService's response shape, which always nests its lines
 * — see orderRecipientSchema below.
 */
export const batchOrderSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  /** Null for a guest one-off purchase, which has no logged-in user behind it
   * (ADR 0025) — the column is nullable and this schema used to claim it wasn't.
   * Nothing caught it because the API returns Prisma rows rather than parsing
   * through here, so the lie only ever surfaced as a type. */
  createdByUserId: z.string().uuid().nullable(),
  status: batchOrderStatusSchema,
  // A plain string column defaulting to "GBP" in Postgres, not a fixed
  // literal — checkout.ts lowercases it for Stripe, so it's read as variable.
  currency: z.string(),
  subtotalMinor: z.number().int().nonnegative(),
  postageMinor: z.number().int().nonnegative(),
  totalMinor: z.number().int().nonnegative(),
  paymentMethod: paymentMethodSchema.nullable(),
  /** How much of this order was paid from the account wallet, in pence. The
   * wallet is always spent before the card (ADR 0169), so a part-paid order
   * records `card` as its payment method while some of it came from here —
   * which is why the split has to be read from this rather than inferred from
   * `paymentMethod`. 0 for an order that used no wallet money. */
  walletAppliedMinor: z.number().int().nonnegative(),
  stripePaymentIntentId: z.string().nullable(),
  /** Stripe's hosted VAT invoice/receipt for a card-paid order — "view online".
   * Null until the invoice.paid webhook lands (and for wallet-paid orders, which
   * have no Stripe charge of their own). See ADR 0102. */
  receiptUrl: z.string().nullable(),
  /** Direct link to Stripe's generated invoice PDF (the downloadable VAT
   * receipt). Null until the invoice.paid webhook lands. */
  receiptPdfUrl: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  orderRecipients: z.array(z.lazy(() => orderRecipientSchema)),
});
export type BatchOrder = z.infer<typeof batchOrderSchema>;

/**
 * One recipient's line within a BatchOrder — design, address, dispatch
 * timing, status. Shipping address is flat columns here (matching the
 * OrderRecipient Prisma model), unlike Recipient's own address fields
 * (see recipient.ts) which happen to share the same flat-column shape by
 * coincidence, not a common type.
 */
export const orderRecipientSchema = z.object({
  id: z.string().uuid(),
  batchOrderId: z.string().uuid(),
  recipientId: z.string().uuid(),
  occasionId: z.string().uuid().nullable(),
  savedDesignId: z.string().uuid(),
  shippingAddressLine1: z.string().min(1).max(200),
  shippingAddressLine2: z.string().max(200).nullable(),
  shippingAddressCity: z.string().min(1).max(120),
  shippingAddressPostcode: z.string().regex(ukPostcodeRegex, "Must be a valid UK postcode"),
  shippingAddressCountry: z.string(),
  dispatchOption: dispatchOptionSchema,
  postageClass: postageClassSchema,
  /** Card price (VAT-inclusive, after plan discount) for this one card. */
  priceMinor: z.number().int().nonnegative(),
  /** Stamp cost for this one card (per-card postage, VAT-exempt). */
  postageMinor: z.number().int().nonnegative(),
  status: orderRecipientStatusSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type OrderRecipient = z.infer<typeof orderRecipientSchema>;

/**
 * A single card line enriched for the buyer's order-detail view: the base
 * OrderRecipient plus the recipient's name (so the buyer sees *who* each card is
 * for, not just a postcode), the Royal Mail tracking reference once posted, and
 * the slug of its digital message page. The heavier detail lives only on the
 * single-order read — the orders *list* stays lean. See docs/adr/0109.
 */
export const orderRecipientLineSchema = orderRecipientSchema.extend({
  recipientFirstName: z.string(),
  recipientLastName: z.string(),
  /** The date this card is scheduled to be posted (its occasion's dispatchDate),
   * or null when it has no occasion. Drives the "scheduled for…" readout and the
   * reschedule control on the order page. See docs/adr/0130-scheduled-sends.md. */
  dispatchDate: z.coerce.date().nullable(),
  /** The card's current fulfilment stage, or null before it's been queued. */
  jobStatus: z.string().nullable(),
  /** Royal Mail tracking reference once the card is posted, else null. */
  trackingReference: z.string().nullable(),
  /** Slug of the card's QR-linked digital message page (/r/:slug), else null. */
  messagePageSlug: z.string().nullable(),
});
export type OrderRecipientLine = z.infer<typeof orderRecipientLineSchema>;

/** A single order with its enriched card lines — the buyer's order-detail read. */
export const batchOrderDetailSchema = batchOrderSchema.extend({
  orderRecipients: z.array(orderRecipientLineSchema),
});
export type BatchOrderDetail = z.infer<typeof batchOrderDetailSchema>;

/** The public Royal Mail "track your item" URL for a tracking reference — the
 * single source of truth shared by the dispatch email and the buyer's order
 * page. */
export function royalMailTrackingUrl(trackingNumber: string): string {
  return `https://www.royalmail.com/track-your-item#/tracking-results/${encodeURIComponent(
    trackingNumber,
  )}`;
}

/**
 * Matches CreateBatchOrderDto/CreateBatchOrderLineDto exactly: recipientId
 * and savedDesignId are deliberately NOT client-supplied — the server
 * derives both from the referenced (already-approved) Occasion, per the
 * design documented on Occasion.savedDesignId in schema.prisma. Payment
 * method isn't part of order creation either; POST /batch-orders/:id/checkout
 * is a separate step. There's no fixed line-count literal here because the
 * real cap is PlanEntitlement.batchOrderMaxSize, enforced dynamically
 * server-side per account — this is just a sane upper safety bound.
 */
export const createBatchOrderInputSchema = z.object({
  lines: z
    .array(
      z.object({
        occasionId: z.string().uuid(),
        shippingAddressLine1: z.string().min(1).max(200),
        shippingAddressLine2: z.string().max(200).optional(),
        shippingAddressCity: z.string().min(1).max(120),
        shippingAddressPostcode: z.string().regex(ukPostcodeRegex, "Must be a valid UK postcode"),
        dispatchOption: dispatchOptionSchema,
        postageClass: postageClassSchema,
      }),
    )
    .min(1)
    .max(200),
});
export type CreateBatchOrderInput = z.infer<typeof createBatchOrderInputSchema>;

/**
 * Matches QuickSendDto — the guided "send this card" flow. Turns a saved design
 * + one recipient into a ready-to-pay draft order in a single call; the returned
 * BatchOrder is then checked out via POST /batch-orders/:id/checkout. See
 * docs/adr/0018-guided-first-order.md.
 */
export const quickSendInputSchema = z.object({
  savedDesignId: z.string().uuid(),
  /** Send to an existing contact from the address book — skips creating a new
   * recipient (and the duplicate that would otherwise create). The name/address
   * fields still carry the shipping details for this order line. */
  recipientId: z.string().uuid().optional(),
  /** When adding a NEW contact (no recipientId), whether to keep it in the
   * address book. Defaults to true; false creates a hidden one-off. Ignored
   * when recipientId is set. */
  saveToContacts: z.boolean().optional(),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  shippingAddressLine1: z.string().min(1).max(200),
  shippingAddressLine2: z.string().max(200).optional(),
  shippingAddressCity: z.string().min(1).max(120),
  shippingAddressPostcode: z.string().regex(ukPostcodeRegex, "Must be a valid UK postcode"),
  postageClass: postageClassSchema,
  occasionType: occasionTypeSchema.optional(),
});
export type QuickSendInput = z.infer<typeof quickSendInputSchema>;

/**
 * Matches BulkSendDto — send one saved design to many existing contacts in a
 * single order. recipientIds reference stored Recipient records; the server
 * pulls each contact's name and address off their record (nothing re-keyed) and
 * returns a ready-to-pay BatchOrder, then checked out via
 * POST /batch-orders/:id/checkout. See docs/adr/0027-bulk-send-to-contacts.md.
 */
export const bulkSendInputSchema = z.object({
  savedDesignId: z.string().uuid(),
  recipientIds: z.array(z.string().uuid()).min(1).max(200),
  postageClass: postageClassSchema,
  occasionType: occasionTypeSchema.optional(),
});
export type BulkSendInput = z.infer<typeof bulkSendInputSchema>;

/**
 * Reschedule a paid, not-yet-posted order to a new arrive-by date (ADR 0130).
 * `deliverBy` is an ISO `YYYY-MM-DD`; the server recomputes each card's post-by
 * date from it. Matches RescheduleBatchOrderDto.
 */
export const rescheduleBatchOrderInputSchema = z.object({
  deliverBy: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "deliverBy must be an ISO date (YYYY-MM-DD)"),
});
export type RescheduleBatchOrderInput = z.infer<typeof rescheduleBatchOrderInputSchema>;

/** A card's QR-linked digital message page. */
export const messagePageSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(6),
  orderRecipientId: z.string().uuid(),
  message: z.string().max(2000).nullable(),
  emoji: z.string().max(8).nullable(),
  videoUrl: z.string().url().nullable(),
  viewCount: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
});
export type MessagePage = z.infer<typeof messagePageSchema>;

/**
 * What an order's cards are actually scheduled to do, summarised from its lines.
 *
 * The order page used to read this off the *first* recipient that had a dispatch
 * date and present that one date as the whole order's. That was true only while
 * every card in an order went on the same day. It stopped being true when bulk
 * sends became occasion-timed (ADR 0160): a segment send to "upcoming birthdays"
 * posts each card ahead of that person's own date, so one order legitimately
 * holds several. The old readout named one of them and stayed silent about the
 * rest — and once the earliest card had gone, the whole banner disappeared while
 * cards were still waiting to post.
 *
 * "Still to come" is decided by each card's status, not by comparing its date to
 * today. A card that has been posted is gone whatever its date says, and the
 * date is what we want to *report* rather than what we should infer state from.
 */
/**
 * An order's send schedule, small enough to put on every row of a list.
 *
 * The endpoints and the counts, never the dates themselves. A bulk sender's
 * order can hold seventy-odd distinct birthdays, and the readout only ever
 * needs "how many dates, first and last" — shipping the array as well would
 * put kilobytes on a row to render one sentence.
 */
export const orderSendScheduleSummarySchema = z.object({
  /** How many distinct post dates are still ahead. */
  dateCount: z.number().int().nonnegative(),
  /** Cards still to be posted, dated or not. */
  toCome: z.number().int().nonnegative(),
  /** Cards already posted, delivered, or returned. */
  gone: z.number().int().nonnegative(),
  /** Cards still to come that carry no date — they go as soon as they're printed. */
  undated: z.number().int().nonnegative(),
  earliest: z.coerce.date().nullable(),
  latest: z.coerce.date().nullable(),
  /** True when the cards still to come don't all share a single post date. */
  isSpread: z.boolean(),
});
export type OrderSendScheduleSummary = z.infer<typeof orderSendScheduleSummarySchema>;

export interface OrderSendSchedule extends OrderSendScheduleSummary {
  /** Distinct post dates still ahead, soonest first. Empty when nothing is due.
   * Only the in-memory summary carries these; the orders *list* sends the
   * counts and endpoints instead, which is all the readout needs. */
  dates: Date[];
}

/** Statuses meaning the card has left us — it is no longer "scheduled". */
const DEPARTED_STATUSES = new Set(["posted", "delivered", "returned_to_sender"]);

/**
 * Summarise the send schedule of an order's card lines. Pure, so the readout can
 * be tested without a database or a rendered page.
 *
 * Cancelled cards are ignored entirely: they aren't going, and counting them
 * would overstate what the customer is waiting for.
 */
export function summariseSendSchedule(
  lines: ReadonlyArray<{ status: string; dispatchDate: Date | string | null }>,
): OrderSendSchedule {
  let toCome = 0;
  let gone = 0;
  let undated = 0;
  const byTime = new Map<number, Date>();

  for (const line of lines) {
    if (line.status === "cancelled") continue;
    if (DEPARTED_STATUSES.has(line.status)) {
      gone += 1;
      continue;
    }
    toCome += 1;
    if (line.dispatchDate === null) {
      undated += 1;
      continue;
    }
    const date =
      line.dispatchDate instanceof Date ? line.dispatchDate : new Date(line.dispatchDate);
    // An unparseable date is worse than no date: reporting `Invalid Date` to a
    // customer is worse than saying nothing, so it falls in with the undated.
    if (Number.isNaN(date.getTime())) {
      undated += 1;
      continue;
    }
    byTime.set(date.getTime(), date);
  }

  const dates = [...byTime.values()].sort((a, b) => a.getTime() - b.getTime());
  return {
    dates,
    dateCount: dates.length,
    toCome,
    gone,
    undated,
    earliest: dates[0] ?? null,
    latest: dates.at(-1) ?? null,
    isSpread: dates.length > 1,
  };
}

/**
 * The customer-facing sentences describing an order's send schedule.
 *
 * Kept here, pure and tested, rather than inline in the page. The wording *is*
 * the deliverable — a customer told us a correct-but-terse readout made them
 * doubt their order had scheduled properly — so the exact strings, their
 * pluralisation and their branching are worth asserting rather than eyeballing.
 * Dates are formatted by the caller, which owns the locale.
 */
export interface SendScheduleCopy {
  /** The headline, after "Scheduled — ". */
  lead: string;
  /** The reassurance underneath, or null when there is nothing to add. */
  detail: string | null;
}

/**
 * Whether an order's send schedule is worth telling anyone about.
 *
 * Only an order that has been paid for is going anywhere — but an occasion
 * carries its dispatch date from the moment it is *approved*, which is before
 * checkout. So an abandoned draft has a perfectly good set of post dates hanging
 * off it, and a screen that renders the schedule unconditionally announces
 * "Scheduled — we'll post these on 4 September" next to a "Not checked out"
 * pill. That contradiction is the same class of confusing signpost this readout
 * was written to remove.
 *
 * A predicate here rather than the condition written out at each call site: the
 * orders list, the order page and the ops order page all show this sentence, and
 * those screens have drifted apart once already.
 */
export function orderScheduleIsLive(status: BatchOrderStatus): boolean {
  return status === "paid" || status === "fulfilling";
}

export function describeSendSchedule(
  schedule: OrderSendScheduleSummary,
  formatDate: (date: Date) => string,
): SendScheduleCopy | null {
  if (schedule.toCome === 0 || schedule.earliest === null) return null;

  // How many of the cards still to come actually carry a date. When some don't,
  // the lead has to say so rather than speak for all of them: "we'll post these
  // on 4 September" immediately above "1 of these has no occasion on file and
  // goes as soon as it's printed" is the readout contradicting itself in
  // consecutive sentences, which is the very thing this copy exists to stop.
  // `dated` is at least 1 here — a schedule with no dates returned null above.
  const dated = schedule.toCome - schedule.undated;
  const subject =
    schedule.undated === 0
      ? schedule.toCome === 1
        ? "it"
        : "these"
      : dated === 1
        ? "one of these"
        : `${dated} of these`;

  const lead = schedule.isSpread
    ? `we'll post ${subject} on ${schedule.dateCount} dates, from ${formatDate(schedule.earliest)} to ${formatDate(schedule.latest!)}.`
    : `we'll post ${subject} on ${formatDate(schedule.earliest)}.`;

  const parts: string[] = [];
  if (schedule.isSpread) {
    // The question the customer actually asked: they chose occasion timing at
    // checkout, so several dates is the feature working, not a fault.
    parts.push(
      "Each card is timed to its own recipient's occasion, so they post on different days — there's nothing to do.",
    );
  }
  if (schedule.undated > 0) {
    const n = schedule.undated;
    parts.push(
      n === 1
        ? "1 of these has no occasion on file and goes as soon as it's printed."
        : `${n} of these have no occasion on file and go as soon as they're printed.`,
    );
  }
  if (schedule.gone > 0) {
    parts.push(
      schedule.gone === 1
        ? "1 card has already been posted."
        : `${schedule.gone} cards have already been posted.`,
    );
  }

  return { lead, detail: parts.length > 0 ? parts.join(" ") : null };
}

/**
 * How many of an order's cards sit at each fulfilment stage.
 *
 * The orders list needs this to decide what to call an order, and nothing more.
 * It used to receive every card's whole row — address, price, timestamps — and
 * read `.status` off each one, which meant a bulk sender's list shipped
 * megabytes to render a handful of pills. A tally is O(1) in the card count.
 */
export const orderCardStatusCountsSchema = z.record(orderRecipientStatusSchema, z.number());
export type OrderCardStatusCounts = Partial<Record<OrderRecipientStatus, number>>;

/** Tally card statuses, so the list and the order page derive the order's
 * headline label from an identical shape. */
export function tallyCardStatuses(
  lines: ReadonlyArray<{ status: OrderRecipientStatus }>,
): OrderCardStatusCounts {
  const counts: OrderCardStatusCounts = {};
  for (const line of lines) {
    counts[line.status] = (counts[line.status] ?? 0) + 1;
  }
  return counts;
}

/**
 * One row of the buyer's orders list.
 *
 * Deliberately NOT the order plus its recipients. That shape shipped 636 bytes
 * per card — a bulk sender's fifty orders of seventy-six cards came to well over
 * two megabytes — to render a card count and a status pill, and it included
 * every recipient's postal address on a page that shows none. (The ops order
 * view already withholds addresses on exactly this reasoning; see
 * adminOrderLineSchema.) The list now carries a count, a status tally and a
 * schedule summary: everything it renders, and nothing it doesn't.
 */
export const batchOrderListRowSchema = batchOrderSchema.omit({ orderRecipients: true }).extend({
  cardCount: z.number().int().nonnegative(),
  cardStatusCounts: orderCardStatusCountsSchema,
  /** When this order's remaining cards post. See summariseSendSchedule. */
  sendSchedule: orderSendScheduleSummarySchema,
});
export type BatchOrderListRow = z.infer<typeof batchOrderListRowSchema>;
