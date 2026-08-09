# 0140 — WordPress migration Phase 2: Stripe billing continuity + verify-first access

## Status

Accepted — implemented. Follows ADR 0139 (Phase 1: accounts, owners, recipients,
subscription status).

## Context

Phase 1 moved the six legacy WooCommerce customers onto the platform with their
subscriptions recorded as active on a **placeholder** id (`wc_sub_<woo>`). Two
things were deliberately left for this follow-up:

1. **Real Stripe billing.** Inspecting the export settled the key question: it
   contains a Stripe **customer** (`cus_…`) and a saved **card** (`pm_…`) per
   account, but **no native Stripe subscription** (`sub_…`) anywhere. WooCommerce
   Subscriptions owned the billing _schedule_ and charged the saved card
   off-session. So there is nothing to "attach" — continuity means **creating** a
   native Stripe subscription on the platform's Pro price.

2. **Verify-first access.** Before any customer is emailed a set-password link,
   tech@kudoscards wants to log into each migrated account and check everything
   looks right.

## Decisions (with the customer)

- **Billing anchor = trial to the WooCommerce next-payment date.** Each new
  Stripe subscription is created with `trial_end` set to that account's
  `_schedule_next_payment`. No charge now; the first platform charge lands exactly
  when WooCommerce's next one would have. Zero gap, and **zero double-charge —
  provided the WooCommerce subscription is cancelled on the WordPress side before
  that date** (a manual step this repo can't perform; the script prints the
  per-account cut-off dates and the report records them).

- **Verify-first = temporary passwords in the private report.** A new
  `--temp-password` flag on the Phase-1 script sets a strong, random,
  per-owner temporary password (and confirms the email so password login works),
  recorded only in the gitignored commit report. The operator logs in as each
  owner, verifies, and later the owner's set-password link (or "Forgot password")
  overrides it. Running `--commit` still **emails nobody** — link delivery remains
  a separate, manual step — so the verify window exists regardless.

## Implementation

### Verify-first (`scripts/migrate-wordpress.ts`, extended)

`--temp-password` → `auth.admin.updateUserById(userId, { password, email_confirm:
true })` per owner; the password is added to each account's report entry and
echoed once at the end. Off by default.

### Billing continuity (`scripts/migrate-wordpress-billing.ts`, new)

Pure decision logic lives in `src/migration/woocommerce-billing.ts`
(`resolveBillingAction`, `buildSubscriptionParams`), unit-tested against
synthetic fixtures. The orchestrator, **dry-run by default**, per account:

1. `resolveBillingAction` — conservative: no customer (comp/manual), no saved
   card, no next-payment date, or a date already past/too-soon ⇒ **skip** with a
   reason. Otherwise **create** with `trial_end` = the next-payment date.
2. Find the migrated account via the `wc_sub_<woo>` placeholder (fallback: the
   account's stored `stripeCustomerId`).
3. **Idempotency**: if a subscription this migration already created exists on the
   customer (recognised by `metadata.migratedFrom = "woocommerce"`), reuse it.
4. `--commit`: `stripe.subscriptions.create` on the Pro price, `default_payment_
method` = the saved card, `metadata:{accountId, planId:"pro", migratedFrom,
wooSubscriptionId}` (so the existing `customer.subscription.*` webhook keeps it
   in sync), `trial_settings.end_behavior.missing_payment_method = "cancel"`. Then,
   in one transaction, **delete the placeholder** `wc_sub_…` row, **upsert the
   real** `sub_…` row, and write an audit entry.

Rotherham North (comp/£0, no Stripe customer) is skipped and stays a manual comp
on its placeholder row.

The Pro price id resolves the same way checkout does: `STRIPE_PRICE_ID_PRO` env,
else the seeded `plan_entitlements.stripePriceId`.

## Privacy / security

- No schema change; no SQL to run.
- The billing report and the temp-password report live in the gitignored
  `apps/api/migration-data/` and contain secrets (temp passwords, set-password
  links) — delete once used.

## Operational order

1. Phase 1 `--commit` (optionally `--temp-password`) → accounts + recipients.
2. Log in with the temp passwords; verify each account.
3. Phase 2 billing `--commit` (LIVE Stripe key) → real subscriptions, anchored.
4. **Cancel the WooCommerce subscriptions** on WordPress (before each printed
   first-charge date) so no one is billed twice.
5. Send owners their set-password links (or point them at "Forgot password").

## Consequences

- Billing carries over with no gap and no immediate charge; the platform's
  webhook owns the subscriptions from creation onward.
- The double-charge risk is real but contained: it depends only on the WooCommerce
  cancellation, which the script surfaces loudly with dated deadlines.
