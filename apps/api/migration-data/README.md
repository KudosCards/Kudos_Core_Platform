# migration-data (gitignored — do not commit anything here but this file)

This directory is where the legacy WordPress/WooCommerce export files are dropped
before running the migration. **Everything in here except this README is
gitignored** because it contains children's personal data (names, dates of birth,
addresses), Stripe customer ids, and one-time set-password links.

## Expected files

- `*_contacts.csv` — one contacts export per legacy account (e.g.
  `Darlington_Kip_McGrath_contacts.csv`). Header:
  `account_name,legacy_contact_id,legacy_user_id,first_name,last_name,gender,`
  `date_of_birth,contact_status,contact_type,address_line_1,city,postcode,email,`
  `is_active,unique_identifier,last_order_date,created_at,updated_at`
- `*subscription_meta.txt` — the tab-separated WooCommerce subscription meta dump
  (`subscription_id`, `meta_key`, `meta_value`). Accounts are joined to their
  subscription via `contacts.legacy_user_id == subscription._customer_user`.

## Running

See `docs/adr/0139` (Phase 1) and `docs/adr/0140` (Phase 2), plus the header of
each script.

### Phase 1 — accounts, owners, recipients (`migrate:wordpress`)

```bash
# dry run — prints a review report, writes nothing, mints no links
DATABASE_URL=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… WEB_APP_URL=… \
  pnpm --filter @kudos/api run migrate:wordpress -- --data ./migration-data

# commit — creates Supabase owners, accounts, subscriptions, recipients.
# Add --temp-password to set a per-owner temporary password (recorded in the
# report) so you can log in and VERIFY each account before owners are emailed.
… --data ./migration-data --commit --temp-password
```

`--commit` emails nobody. It writes `migration-report-<timestamp>.json` here
containing each owner's one-time set-password link (and, with `--temp-password`,
their temporary password). **Secret — delete once used.**

### Phase 2 — Stripe billing continuity (`migrate:wordpress-billing`)

Run after Phase 1 and after you've verified the accounts.

```bash
# dry run — reads Stripe + DB, prints the plan, creates nothing
DATABASE_URL=… STRIPE_SECRET_KEY=… [STRIPE_PRICE_ID_PRO=…] \
  pnpm --filter @kudos/api run migrate:wordpress-billing -- --data ./migration-data

# commit — creates native Stripe subs (trial to each WooCommerce next-payment
# date) and replaces the placeholder subscription rows. Use the LIVE Stripe key.
… --data ./migration-data --commit
```

Writes `billing-migration-report-<timestamp>.json` here.

> ⚠️ **After Phase 2 you MUST cancel the WooCommerce subscriptions on WordPress**
> (before each account's printed first-charge date) so customers aren't billed
> twice. This repo can't touch WordPress.
