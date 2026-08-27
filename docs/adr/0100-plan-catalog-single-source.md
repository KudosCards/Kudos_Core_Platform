# 0100 — One source of truth for subscription plan marketing

## Status

Accepted

## Context

How the three membership plans were _presented_ had drifted badly across the
site. Each surface hard-coded its own plan list:

- **Landing page** (`page.tsx`): Free / Pro / Centre, with feature bullets that
  were partly invented ("Community support", "Priority support", "Dedicated
  support" — no such support tiers exist) and that omitted the real
  differentiators (custom artwork, team seats).
- **Billing page** (`billing-client.tsx`): named the free tier **"Starter"**,
  showed only a one-line description and no feature list — a customer couldn't
  see what an upgrade would actually get them.
- **Ops/admin** (`lib/admin.ts`): relabelled the plans again — **pro → "Starter",
  centre → "Growth"** — so support staff saw different names than customers.

So the same plan could be called "Pro", "Starter" or "Growth" depending on where
you looked, and the quoted per-card discount lived separately from the code that
actually charges it. This is the inconsistency the sweep set out to fix.

## Decision

Introduce a single **`PLAN_CATALOG`** in `@kudos/shared-types` (`plans.ts`) as
the one source of truth for how plans are named, priced and described, and make
every surface read from it.

1. **Canonical names: Free / Pro / Centre.** Chosen because they already match
   the landing page and the real Stripe product names ("Kudos Cards — Pro/Centre")
   — i.e. what customers are actually billed under. The billing page's "Starter"
   and the admin's "Starter/Growth" relabelling are removed.

2. **The catalog carries name, tagline, monthly price, card discount, the real
   limits (contacts, bulk size, seats) and an accurate, differentiated feature
   list** phrased for a pricing table, plus an "Everything in X, plus:" lead-in
   for the paid tiers. Card prices are derived from `CARD_PRICE_MINOR` × the
   plan discount via `planCardPriceMinor` / `planCardPriceLabel`, so the price
   shown is computed, never re-typed.

3. **Helpers** — `planDisplayName(id)` (used everywhere a plan is named, with a
   safe capitalised fallback), `formatPlanPrice`, `planCardPriceLabel` — so the
   strings are assembled identically on every page.

4. **Consumers updated** to read the catalog: the landing pricing section, the
   in-app billing page (now a full feature comparison with the current plan
   highlighted and a "Most popular" marker), the get-started activation step,
   the app-shell plan chip, and the ops/admin plan labels + subscriber filter.

5. **A guard test** (`billing/plans.spec.ts`) asserts `planCardPriceMinor(plan)
=== computeCardPriceMinor(plan.cardDiscountPercent)` for every plan, tying the
   marketing price to the price the API charges so the two can't silently
   diverge, plus that the names stay Free / Pro / Centre.

The enforced _limits_ still live in the DB (`PlanEntitlement`, seeded in
`prisma/seed.ts`) — that remains the source of truth for what the API allows.
The catalog is the _display_ layer, kept in step with that seed and cross-checked
for pricing by the guard test.

## Consequences

- A plan is named and priced identically on the landing page, the billing page,
  onboarding, the app shell and the ops views — change the catalog once and every
  surface follows.
- The billing page now sells upgrades: each tier shows its real feature set and
  card discount, not a bare one-liner.
- Marketing copy is now truthful — invented support tiers are gone; the bullets
  reflect actual entitlements (contacts, auto-send, custom artwork, team seats,
  bulk-send size, per-card discount).
- Web-only + one shared-types module; no API behaviour or schema change. The
  guard test fails CI if the quoted card price and the charged card price ever
  drift apart.
