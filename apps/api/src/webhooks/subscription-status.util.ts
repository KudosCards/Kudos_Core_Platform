import type Stripe from "stripe";
import type { SubscriptionStatus } from "@prisma/client";

/**
 * Our SubscriptionStatus enum is a deliberate subset of Stripe's — Checkout
 * (no pause-collection, no manual invoicing) never produces "paused", and
 * "unpaid"/"incomplete_expired" are rare edge cases we fold into the closest
 * status that still means "this account isn't paying right now":
 *   - incomplete_expired -> canceled (the checkout was abandoned; no sub exists)
 *   - unpaid / paused    -> past_due (billing problem, not an outright cancellation)
 */
export function mapStripeSubscriptionStatus(
  status: Stripe.Subscription.Status,
): SubscriptionStatus {
  switch (status) {
    case "active":
    case "trialing":
    case "past_due":
    case "canceled":
    case "incomplete":
      return status;
    case "incomplete_expired":
      return "canceled";
    case "unpaid":
    case "paused":
      return "past_due";
  }
}
