# 0127 — Centre plan: cap contacts at 2,000 (was unlimited)

## Status

Accepted

## Context

The Centre plan (£19.97/mo, ADR 0100/0035) shipped with an **unlimited**
contact allowance — `recipientCap: null` in both the `PLAN_CATALOG` marketing
layer and the seeded `PlanEntitlement`, and an "Unlimited contacts" feature
line. Unlimited is hard to support and price against at the top of the
self-serve range: a genuinely large customer (thousands of contacts, bulk
sends, address-resolution and postage costs) is exactly who Enterprise (ADR
0101, "Contact us") exists to price by hand. Leaving Centre uncapped blurred
the line between the self-serve tier and the bespoke one.

## Decision

Give Centre a concrete ceiling of **2,000 active contacts**, so the three
self-serve plans now step 50 → 200 → 2,000, and anything larger routes to
Enterprise.

1. **One number, two mirrored places.** `recipientCap` becomes `2000` in
   `packages/shared-types/src/plans.ts` (the display source of truth) and in the
   `PLAN_ENTITLEMENTS` seed in `apps/api/prisma/seed.ts` (the enforced source of
   truth). The marketing feature line changes from "Unlimited contacts" to
   "Up to 2,000 contacts", matching the "Up to N contacts" phrasing already used
   for Free and Pro.

2. **No enforcement code changes.** The recipient cap is already enforced
   against `recipientCap` in `RecipientsService` (create, CSV import, CRM
   ingest), which treats a non-null cap uniformly — `null` meant "skip the
   count/limit", any number means "block once active count + additions exceed
   it". A finite Centre cap flows through the existing paths unchanged; only the
   value differs.

3. **No schema/migration.** `PlanEntitlement.recipientCap` stays nullable (the
   column still models "unlimited" should a future plan want it); this is a data
   change applied by re-running the idempotent seed, which upserts every plan
   entitlement on deploy.

## Consequences

- The self-serve range now has a clean top-out (2,000) and a clear hand-off to
  Enterprise for anything above it, instead of an open-ended tier.
- Existing Centre accounts are subject to the new cap once the seed re-runs.
  Anyone already **over** 2,000 active contacts is not modified — the cap only
  blocks *adding beyond* it (active count + additions must fit), so they keep
  their contacts and simply can't grow the list until under the cap; ops can move
  such an account to Enterprise. In practice the beta has no account near 2,000.
- The stale "self-serve plans top out at unlimited contacts" framing in ADR 0101
  is superseded by this ADR; the Enterprise rationale (bespoke pricing for large
  orgs) is unchanged and now has a sharper boundary.
- `docs/adr/0101` is left as the historical record of the Enterprise decision;
  this ADR is the current word on the Centre allowance.
