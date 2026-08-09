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

See `docs/adr/0139-wordpress-migration.md` and the header of
`apps/api/scripts/migrate-wordpress.ts`.

```bash
# dry run — prints a review report, writes nothing, mints no links
DATABASE_URL=… SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… WEB_APP_URL=… \
  pnpm --filter @kudos/api run migrate:wordpress -- --data ./migration-data

# commit — creates Supabase owners, accounts, subscriptions, recipients
… --data ./migration-data --commit
```

Each run writes a `migration-report-<timestamp>.json` here. The commit report
contains the owners' one-time set-password links — treat it as a secret and
delete it once the links have been delivered.
