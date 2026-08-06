import { z } from "zod";
import { ukPostcodeRegex } from "./recipient";
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
  createdByUserId: z.string().uuid(),
  status: batchOrderStatusSchema,
  // A plain string column defaulting to "GBP" in Postgres, not a fixed
  // literal — checkout.ts lowercases it for Stripe, so it's read as variable.
  currency: z.string(),
  subtotalMinor: z.number().int().nonnegative(),
  postageMinor: z.number().int().nonnegative(),
  totalMinor: z.number().int().nonnegative(),
  paymentMethod: paymentMethodSchema.nullable(),
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
