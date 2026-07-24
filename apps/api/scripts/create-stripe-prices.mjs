#!/usr/bin/env node
/**
 * Create (idempotently) the recurring Stripe Prices that Kudos Cards charges on:
 * the Pro and Centre plan subscriptions, and the extra-Centre-seat add-on. Then
 * print the env-var lines to paste into Railway → Variables.
 *
 * WHY THIS EXISTS: subscription/seat checkout needs real Stripe Price objects,
 * which can only be created against a live Stripe account with the secret key —
 * not from CI or a sandbox. This script does it in one command wherever the key
 * is available.
 *
 * RUN IT (uses whichever key is in the environment; live or test):
 *   # with Railway's env injected (recommended — uses your live key):
 *   railway run pnpm --filter @kudos/api create-stripe-prices
 *   # or directly:
 *   STRIPE_SECRET_KEY=sk_live_... node apps/api/scripts/create-stripe-prices.mjs
 *
 * IDEMPOTENT: each Price carries a stable `lookup_key`, so re-running finds and
 * reuses the existing Price instead of creating duplicates. Amounts are
 * VAT-inclusive (tax_behavior: "inclusive"), matching the app's pricing.
 *
 * After it prints the three lines, set them in Railway and redeploy — no
 * re-seed needed (the app resolves plan prices from these env vars at runtime).
 * See docs/adr/0036-payment-go-live.md.
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error(
    "STRIPE_SECRET_KEY is not set.\n" +
      "Run where the key is available, e.g.  railway run pnpm --filter @kudos/api create-stripe-prices",
  );
  process.exit(1);
}

const stripe = new Stripe(key);

/** amount is in pence, VAT-inclusive. */
const PRICES = [
  {
    envVar: "STRIPE_PRICE_ID_PRO",
    productName: "Kudos Cards — Pro",
    lookupKey: "kudos_pro_monthly",
    unitAmount: 997,
  },
  {
    envVar: "STRIPE_PRICE_ID_CENTRE",
    productName: "Kudos Cards — Centre",
    lookupKey: "kudos_centre_monthly",
    unitAmount: 1997,
  },
  {
    envVar: "STRIPE_CENTRE_SEAT_PRICE_ID",
    productName: "Kudos Cards — Centre extra seat",
    lookupKey: "kudos_centre_seat_monthly",
    unitAmount: 500,
  },
];

/** Reuse an existing active product with this exact name, else create one.
 * (Product search is only reached when the price doesn't yet exist, so this
 * can't create duplicate products on a normal re-run.) */
async function findOrCreateProduct(name) {
  const existing = await stripe.products.search({
    query: `active:'true' AND name:'${name.replace(/'/g, "\\'")}'`,
  });
  return existing.data[0] ?? (await stripe.products.create({ name }));
}

async function ensurePrice({ envVar, productName, lookupKey, unitAmount }) {
  // prices.list by lookup_key is immediately consistent — the idempotency anchor.
  const found = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  if (found.data[0]) {
    return { envVar, id: found.data[0].id, reused: true };
  }
  const product = await findOrCreateProduct(productName);
  const price = await stripe.prices.create({
    product: product.id,
    currency: "gbp",
    unit_amount: unitAmount,
    recurring: { interval: "month" },
    tax_behavior: "inclusive",
    lookup_key: lookupKey,
    nickname: `${productName} (£${(unitAmount / 100).toFixed(2)}/mo incl. VAT)`,
  });
  return { envVar, id: price.id, reused: false };
}

const mode = key.startsWith("sk_live") ? "LIVE" : "TEST";
console.error(`Using ${mode} Stripe key.\n`);

const results = [];
for (const price of PRICES) {
  results.push(await ensurePrice(price));
}

console.error("Set these in Railway → Variables, then redeploy:\n");
for (const r of results) {
  console.log(`${r.envVar}=${r.id}${r.reused ? "   # reused existing" : "   # created"}`);
}
console.error(`\nDone (${mode} mode). Remember: live and test prices are different ids.`);
