import { CARD_PRICE_MINOR } from "./pricing";

/**
 * The single source of truth for how the three membership plans are *presented*
 * across the whole product — the marketing landing page, the in-app billing
 * page, the get-started activation step and the ops/admin views all read from
 * `PLAN_CATALOG` so a plan's name, price and feature list never drift between
 * surfaces again.
 *
 * This is the *display* layer. The plans' enforced limits live in the database
 * (`PlanEntitlement`, seeded in apps/api/prisma/seed.ts) and are the source of
 * truth for what the API actually allows; the numbers quoted here are kept in
 * step with that seed. Card prices are VAT-inclusive; the per-plan discount is
 * applied on top of `CARD_PRICE_MINOR`. See docs/adr/0008-checkout-pricing.md
 * and docs/adr/0035-seat-based-billing.md.
 */

/** The canonical plan identifiers — unchanged in the DB and in Stripe. */
export type PlanId = "free" | "pro" | "centre";

/** The two paid plans, in upgrade order (Free has no Stripe object at all). */
export const PAID_PLAN_IDS = ["pro", "centre"] as const;
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

export interface PlanMarketing {
  id: PlanId;
  /** Canonical customer-facing name — Free / Pro / Centre, used everywhere. */
  name: string;
  /** One-line audience/positioning line shown under the name. */
  tagline: string;
  /** Recurring price, VAT-inclusive (pence). 0 for Free. */
  monthlyPriceMinor: number;
  /** Card discount as a whole-number percent, applied to CARD_PRICE_MINOR. */
  cardDiscountPercent: number;
  /** Contact limit; null = unlimited. Mirrors PlanEntitlement.recipientCap. */
  recipientCap: number | null;
  /** Largest single bulk send. Mirrors PlanEntitlement.batchOrderMaxSize. */
  batchOrderMaxSize: number;
  /** Team seats included before per-seat charges. Mirrors includedSeats. */
  includedSeats: number;
  /** Marks the plan we steer people toward ("Most popular"). */
  highlight: boolean;
  /** "Everything in X, plus:" lead-in for a paid tier (null for Free). */
  inherits: string | null;
  /** The plan's headline capabilities, phrased for a pricing table. */
  features: string[];
}

export const PLAN_CATALOG: readonly PlanMarketing[] = [
  {
    id: "free",
    name: "Free",
    tagline: "For getting started",
    monthlyPriceMinor: 0,
    cardDiscountPercent: 0,
    recipientCap: 50,
    batchOrderMaxSize: 10,
    includedSeats: 1,
    highlight: false,
    inherits: null,
    features: [
      "Up to 50 contacts",
      "Full card designer & template library",
      "Birthday calendar & email reminders",
      "You approve every card before it's sent",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For growing centres",
    monthlyPriceMinor: 997,
    cardDiscountPercent: 10,
    recipientCap: 200,
    batchOrderMaxSize: 200,
    includedSeats: 1,
    highlight: true,
    inherits: "Everything in Free, plus:",
    features: [
      "Up to 200 contacts",
      "Auto-send birthdays on autopilot",
      "Upload your own card artwork",
      "10% off every card",
    ],
  },
  {
    id: "centre",
    name: "Centre",
    tagline: "For established centres & teams",
    monthlyPriceMinor: 1997,
    cardDiscountPercent: 15,
    recipientCap: null,
    batchOrderMaxSize: 500,
    includedSeats: 3,
    highlight: false,
    inherits: "Everything in Pro, plus:",
    features: [
      "Unlimited contacts",
      "3 team seats included (£5/mo each after)",
      "Bulk-send up to 500 cards at once",
      "15% off every card",
    ],
  },
];

/** Look up a plan's marketing entry by id. */
export function getPlan(planId: string): PlanMarketing | undefined {
  return PLAN_CATALOG.find((plan) => plan.id === planId);
}

/**
 * The canonical display name for a plan id — Free / Pro / Centre — with a safe
 * capitalised fallback for any unknown id. Use this everywhere a plan is named.
 */
export function planDisplayName(planId: string | null | undefined): string {
  if (!planId) return "No plan";
  return getPlan(planId)?.name ?? planId.charAt(0).toUpperCase() + planId.slice(1);
}

/** The discounted, VAT-inclusive price of one card on this plan (pence). */
export function planCardPriceMinor(plan: PlanMarketing): number {
  return Math.round(CARD_PRICE_MINOR * (1 - plan.cardDiscountPercent / 100));
}

/** "£0" / "£9.97" — plain GBP, no cadence. */
export function formatPlanPrice(minor: number): string {
  return `£${(minor / 100).toFixed(2)}`.replace(/\.00$/, "");
}

/** "£2.50 / card" or "£2.25 / card · 10% off" — identical wherever it's shown. */
export function planCardPriceLabel(plan: PlanMarketing): string {
  const price = `£${(planCardPriceMinor(plan) / 100).toFixed(2)} / card`;
  return plan.cardDiscountPercent > 0 ? `${price} · ${plan.cardDiscountPercent}% off` : price;
}
