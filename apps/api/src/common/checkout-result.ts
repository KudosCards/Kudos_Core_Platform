/** Shared response shape for every endpoint that hands back a Stripe Checkout redirect URL. */
export interface CheckoutResult {
  checkoutUrl: string;
}
