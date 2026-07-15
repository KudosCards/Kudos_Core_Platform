import { z } from "zod";
import { addressSchema } from "./recipient";
import { dispatchOptionSchema, orderRecipientStatusSchema, postageClassSchema } from "./enums";

/**
 * One order representing a whole batch (e.g. "10 birthday cards this week").
 * Replaces the legacy pattern of one WooCommerce cart line per recipient.
 */
export const batchOrderSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  createdByUserId: z.string().uuid(),
  status: z.enum(["draft", "pending_payment", "paid", "fulfilling", "completed", "cancelled"]),
  currency: z.literal("GBP"),
  subtotalMinor: z.number().int().nonnegative(),
  postageMinor: z.number().int().nonnegative(),
  totalMinor: z.number().int().nonnegative(),
  paymentMethod: z.enum(["card", "wallet"]).nullable(),
  stripePaymentIntentId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type BatchOrder = z.infer<typeof batchOrderSchema>;

/** One recipient's line within a BatchOrder — design, address, dispatch timing, status. */
export const orderRecipientSchema = z.object({
  id: z.string().uuid(),
  batchOrderId: z.string().uuid(),
  recipientId: z.string().uuid(),
  occasionId: z.string().uuid().nullable(),
  savedDesignId: z.string().uuid(),
  shippingAddress: addressSchema,
  dispatchOption: dispatchOptionSchema,
  postageClass: postageClassSchema,
  priceMinor: z.number().int().nonnegative(),
  status: orderRecipientStatusSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type OrderRecipient = z.infer<typeof orderRecipientSchema>;

export const createBatchOrderInputSchema = z.object({
  lines: z
    .array(
      z.object({
        recipientId: z.string().uuid(),
        occasionId: z.string().uuid().nullable(),
        savedDesignId: z.string().uuid(),
        shippingAddress: addressSchema,
        dispatchOption: dispatchOptionSchema,
        postageClass: postageClassSchema,
      }),
    )
    .min(1)
    .max(20), // mirrors the current plan-enforced multi-card order cap
  paymentMethod: z.enum(["card", "wallet"]),
});
export type CreateBatchOrderInput = z.infer<typeof createBatchOrderInputSchema>;

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
