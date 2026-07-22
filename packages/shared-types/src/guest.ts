import { z } from "zod";
import { ukPostcodeRegex } from "./recipient";
import { occasionTypeSchema, postageClassSchema } from "./enums";

/**
 * A guest one-off purchase — POST /guest/checkout. An unauthenticated visitor
 * buys and sends a single personalised card; the API mints a guest account
 * server-side. Deliberately carries NO accountId (a public endpoint must never
 * let the caller aim an order at an existing account). See docs/adr/0025.
 */
export const guestCheckoutInputSchema = z.object({
  /** The public card design (template) being personalised. */
  cardDesignId: z.string().uuid(),
  /** The personalised DesignDocument JSON; omit to use the template unedited. */
  document: z.record(z.string(), z.unknown()).optional(),
  /** The buyer's email — receipt + account-claim link. */
  buyerEmail: z.string().email(),
  recipientFirstName: z.string().min(1).max(120),
  recipientLastName: z.string().min(1).max(120),
  shippingAddressLine1: z.string().min(1).max(200),
  shippingAddressLine2: z.string().min(1).max(200).optional(),
  shippingAddressCity: z.string().min(1).max(120),
  shippingAddressPostcode: z.string().regex(ukPostcodeRegex, "Must be a valid UK postcode"),
  /** Defaults to second class server-side if omitted. */
  postageClass: postageClassSchema.optional(),
  occasionType: occasionTypeSchema.optional(),
});
export type GuestCheckoutInput = z.infer<typeof guestCheckoutInputSchema>;

/** POST /guest/checkout response — the Stripe redirect + the created order id. */
export const guestCheckoutResultSchema = z.object({
  checkoutUrl: z.string().url(),
  orderId: z.string().uuid(),
});
export type GuestCheckoutResult = z.infer<typeof guestCheckoutResultSchema>;

/** The most cards a guest basket can hold in one payment — mirrors the free
 * plan's per-order cap (see the API's GUEST_CART_MAX_ITEMS / prisma seed). */
export const GUEST_CART_MAX_ITEMS = 20;

/**
 * One personalised card in a guest basket — {@link guestCheckoutInputSchema}
 * minus the buyer email (which is per-basket, not per-card).
 */
export const guestCartItemSchema = z.object({
  cardDesignId: z.string().uuid(),
  document: z.record(z.string(), z.unknown()).optional(),
  recipientFirstName: z.string().min(1).max(120),
  recipientLastName: z.string().min(1).max(120),
  shippingAddressLine1: z.string().min(1).max(200),
  shippingAddressLine2: z.string().min(1).max(200).optional(),
  shippingAddressCity: z.string().min(1).max(120),
  shippingAddressPostcode: z.string().regex(ukPostcodeRegex, "Must be a valid UK postcode"),
  postageClass: postageClassSchema.optional(),
  occasionType: occasionTypeSchema.optional(),
});
export type GuestCartItem = z.infer<typeof guestCartItemSchema>;

/**
 * A guest basket checkout — POST /guest/cart-checkout. Several personalised
 * cards bought and sent in one payment, no account. The API mints one guest
 * account server-side and builds a single batch order. See docs/adr/0025.
 */
export const guestCartCheckoutInputSchema = z.object({
  buyerEmail: z.string().email(),
  items: z.array(guestCartItemSchema).min(1).max(GUEST_CART_MAX_ITEMS),
});
export type GuestCartCheckoutInput = z.infer<typeof guestCartCheckoutInputSchema>;

/** GET /guest/claim/:token — the email a claim token is tied to, for prefill. */
export const guestClaimInfoSchema = z.object({
  email: z.string().email(),
});
export type GuestClaimInfo = z.infer<typeof guestClaimInfoSchema>;

/** POST /guest/claim body — the single-use claim token. */
export const guestClaimInputSchema = z.object({
  claimToken: z.string().min(1),
});
export type GuestClaimInput = z.infer<typeof guestClaimInputSchema>;
