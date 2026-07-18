/**
 * One-off bootstrap: create the Stripe subscription Products + Prices for the
 * paid plans and wire their price ids into `plan_entitlements`, so
 * `POST /subscriptions/checkout` stops returning "not yet configured".
 *
 * Run it wherever the env already holds the credentials (so no secret is ever
 * pasted around) — e.g. on Railway:
 *
 *   railway run pnpm --filter @kudos/api run setup:stripe-plans
 *
 * or locally with the two vars exported:
 *
 *   STRIPE_SECRET_KEY=sk_live_... DATABASE_URL=postgres://... \
 *     pnpm --filter @kudos/api run setup:stripe-plans
 *
 * Idempotent: it looks each plan's price up by a stable Stripe `lookup_key`
 * and reuses it if present, so re-running never creates duplicates. Whichever
 * mode (test/live) the STRIPE_SECRET_KEY belongs to is the mode the Prices are
 * created in — use the live key when you're ready to take real subscriptions.
 */
import Stripe from "stripe";
import { PrismaClient } from "@prisma/client";

/** £9.97 / £19.97 per month, VAT-inclusive — see the billing plans + runbook §2a. */
const PLANS = [
  { planId: "pro", productName: "Kudos Cards — Pro", amountMinor: 997 },
  { planId: "centre", productName: "Kudos Cards — Centre", amountMinor: 1997 },
] as const;

async function findExistingPrice(stripe: Stripe, lookupKey: string): Promise<string | null> {
  const { data } = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  return data[0]?.id ?? null;
}

async function ensurePlanPrice(
  stripe: Stripe,
  plan: (typeof PLANS)[number],
): Promise<{ priceId: string; reused: boolean }> {
  const lookupKey = `kudos_${plan.planId}_monthly`;

  const existing = await findExistingPrice(stripe, lookupKey);
  if (existing) {
    return { priceId: existing, reused: true };
  }

  const product = await stripe.products.create({
    name: plan.productName,
    metadata: { kudos_plan: plan.planId },
  });
  const price = await stripe.prices.create({
    product: product.id,
    currency: "gbp",
    unit_amount: plan.amountMinor,
    recurring: { interval: "month" },
    lookup_key: lookupKey,
    metadata: { kudos_plan: plan.planId },
  });
  return { priceId: price.id, reused: false };
}

async function main(): Promise<void> {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not set");
  }
  const mode = secretKey.startsWith("sk_live_") ? "LIVE" : "test";
  console.log(`Using Stripe in ${mode} mode.`);

  const stripe = new Stripe(secretKey);
  const prisma = new PrismaClient();

  try {
    for (const plan of PLANS) {
      const { priceId, reused } = await ensurePlanPrice(stripe, plan);
      await prisma.planEntitlement.update({
        where: { planId: plan.planId },
        data: { stripePriceId: priceId },
      });
      console.log(
        `${reused ? "Reused" : "Created"} ${mode} price for "${plan.planId}": ${priceId} → wrote to plan_entitlements`,
      );
    }
    console.log("\nDone. Reload /billing — upgrades are now enabled.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
