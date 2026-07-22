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
