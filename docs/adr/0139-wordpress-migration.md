# 0139 — WordPress/WooCommerce customer migration (Phase 1)

## Status

Accepted — implemented (Phase 1). Stripe billing continuity is a follow-up.

## Context

The legacy Kudos Cards product ran on WordPress + WooCommerce Subscriptions. Six
live customers need to move onto this platform without losing their contact book
or their paid standing:

- **5 Kip McGrath tutoring centres** (Darlington, Ashfield, Oldham North, Hull
  East, Rotherham North) and **Anytime Fitness Putney**.
- **500 contacts** — the students/members each centre posts cards to. Every
  contact carries a date of birth (so these are, in the main, **children's
  records** — a UK GDPR consideration that runs through the whole design).
- Each account has a WooCommerce subscription (£9.97/mo inc VAT; Rotherham is a
  £0 comp/manual renewal).

We were given two exports, and nothing else — in particular **no card designs
and no order history**:

- One `*_contacts.csv` per account (the contact book).
- One tab-separated `*subscription_meta.txt` dump (WooCommerce subscription meta:
  billing identity, Stripe customer id, next-payment date, …).

The contacts export and the subscription dump join cleanly on
`contacts.legacy_user_id == subscription._customer_user` (verified 1:1 across all
six accounts).

### Decisions taken with the customer (tech@kudoscards.co.uk)

1. **Owner login = a branded "set your password" invite link.** Lower effort and
   more secure than a shared password (the platform has no forced-change-on-first
   -login gate, so a shared password would land people in an unprotected state).
   Reuses the existing customer set-password flow (`/reset-password`, ADR 0051).
2. **Plan = Pro, marked active now.** All six accounts fit comfortably under the
   Pro recipient cap (200; the largest is Oldham at 148).
3. **Billing continuity is out of scope for this PR.** Subscriptions are recorded
   as `active` with the period end taken from WooCommerce; wiring the _real_
   Stripe subscription is a **follow-up PR**.
4. **Scope = accounts + owners + recipients + subscription status only.** Card
   designs and order history are not in the export.

## Decision

A one-off, **idempotent, dry-run-by-default** migration, split into a pure
mapping/join library (unit-tested) and a thin orchestrator that does the I/O.

### Pure library — `src/migration/wordpress-migration.ts`

All the risky logic lives here so it is testable against **synthetic fixtures,
never real children's data** (`wordpress-migration.spec.ts`, 18 cases):

- Parses the subscription meta (splitting on the first two tabs only, so a meta
  value that itself contains tabs — e.g. `_billing_address_index` — survives) and
  indexes it by `_customer_user`.
- Maps each contact row → recipient: `former` → **archived**, everything else →
  **active**; the WooCommerce `blank@blank.com` placeholder and empty strings →
  **no email**; an absent/malformed/**future** date of birth is dropped with a
  warning rather than failing the row.
- Joins each contacts group to its subscription and builds a per-account plan
  (owner identity, Stripe customer id, next-payment date, recipients, warnings).
  A missing owner email is fatal (an account with no login is meaningless); every
  other data issue is a non-fatal warning surfaced in the review report.

### Orchestrator — `scripts/migrate-wordpress.ts`

- **Dry run by default**: prints a per-account review table + writes a JSON
  report, touching neither the database nor Supabase. `--commit` performs the
  writes. (Verified against the real export: 6 accounts, 500 recipients, 0
  warnings.)
- **Owner + invite link**: `auth.admin.generateLink` with `type: "invite"`
  creates the Supabase auth user and returns a one-time token; we build our own
  `/reset-password?token_hash=…&type=invite` link (PKCE-safe, scanner-safe — see
  ADR 0051). A re-run finds the existing user and mints a `recovery` link
  instead.
- **Account + subscription + recipients** are all **upserted** — accounts matched
  on the stable owner user id, recipients on `(accountId, "wordpress",
legacy_contact_id)`, subscriptions on a placeholder id — so the migration is
  safe to re-run. Active recipients with a DOB get their birthday occasion
  scheduled via the shared `buildScheduledBirthdayOccasion` util. Each account's
  import writes an `AuditLogEntry` (`action: "migrate_wordpress"`), because
  importing children's data is a GDPR event we must be able to evidence.

### Subscription placeholder

The export gives a Stripe **customer** id (`cus_…`) but not a **subscription** id
(`sub_…`). Phase 1 stores the customer id on the account and uses a stable
placeholder `stripeSubscriptionId` of `wc_sub_<wooSubscriptionId>` so the
subscription row (status `active`, period end from WooCommerce) exists now. The
follow-up Stripe PR reconciles the real `sub_…` and its authoritative status.

## Privacy / GDPR

- The export files, and the generated report (which in `--commit` mode contains
  the owners' one-time set-password links), are **children's personal data and
  secrets**. They live in the **gitignored** `apps/api/migration-data/` directory
  and are **never committed** — only its `README.md` is tracked.
- The whole migration is audit-logged per account.

## Out of scope (follow-up PR)

- **Stripe billing continuity**: attach the live Stripe subscriptions, replace
  the placeholder subscription id + status with the real ones, and make sure no
  one is double-charged.
- Card designs / order history, if a later export provides them.

## Consequences

- The six customers can log in (via their own password), see their full contact
  book with birthdays already on the calendar, and show as active Pro
  subscribers on day one.
- The mapping logic is covered by fast unit tests; the destructive parts are
  gated behind `--commit` and are idempotent, so the real run can be rehearsed as
  a dry run first and safely retried.
