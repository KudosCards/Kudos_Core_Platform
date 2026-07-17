# Go-live runbook

Everything needed to take Kudos Cards from "feature-complete" to "live and taking real orders".
The platform is built and tested end-to-end; what remains is external-service configuration and a
staged verification, most of which can only be done from the Supabase / Stripe / Railway / Netlify
dashboards. Work top to bottom — later steps assume earlier ones are done.

Legend: 🧑 = you (dashboard/manual), 🤖 = already handled in code.

---

## 0. What's already done 🤖

- API (Railway) applies migrations automatically on every deploy (`start:deploy` runs
  `prisma migrate deploy` before boot — see README "Deployment").
- Web (Netlify) auto-deploys on every push to `main` via `netlify.toml`.
- All app config is env-var driven and validated at boot (`apps/api/src/config/env.schema.ts`) —
  a missing/blank required var fails the deploy loudly instead of misbehaving at runtime.

---

## 1. Supabase 🧑

### 1a. Storage buckets

Two **public-read** buckets must exist (uploads go direct from the browser via signed URLs; the
public read is what lets a saved design / message video render later):

| Bucket | Used by | Recommended limits |
|---|---|---|
| `design-assets` | card designer image uploads (Phase 2) | `allowedMimeTypes`: image/png, image/jpeg, image/webp, image/gif · `fileSizeLimit`: ~5 MB |
| `message-videos` | message-page video uploads (Phase 4) | `allowedMimeTypes`: video/mp4, video/quicktime, video/webm · `fileSizeLimit`: ~50 MB |

> The API validates the *claimed* content-type in its DTOs, but the installed Supabase SDK can't
> enforce what's actually uploaded to a signed URL — the bucket's `allowedMimeTypes`/`fileSizeLimit`
> are the real enforcement. This is why the limits above matter (see ADR 0009 and the note in
> `storage.service.ts`). Create both buckets as **Public**.

### 1b. Auth

- Confirm the project's email auth (or whichever providers you want) is enabled — the app uses
  `@supabase/ssr` session cookies.
- No JWT secret to copy anywhere: the API verifies session tokens against the project's JWKS
  endpoint, so it keeps working automatically if Supabase rotates its signing key (ADR 0005).

### 1c. Connection strings

- `DATABASE_URL` = the **pooled** connection (app runtime). **Must include `?pgbouncer=true`** — and,
  because the API runs long-lived on Railway, a modest cap like `&connection_limit=10`. Use the
  Supabase *Transaction* pooler string (port **6543**).
- `DIRECT_URL` = the **direct** connection (port **5432**), used for migrations only.

> ⚠️ **This is the #1 cause of intermittent "a server error occurred" pages in production.** Without
> `?pgbouncer=true`, Prisma issues prepared statements that Supabase's transaction-mode pooler can't
> reuse, so *random* authenticated requests fail with `prepared statement "s0" already exists` /
> `... does not exist` — the errors look transient and hit whatever page you happen to load (e.g.
> `/recipients`), and never reproduce against a plain local Postgres. Example:
> `postgresql://…@…pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=10`

---

## 2. Stripe 🧑

### 2a. Products & Prices (needed for subscription checkout)

Create two **recurring monthly** Prices and copy their `price_...` ids:

| Plan | Price | Notes |
|---|---|---|
| Pro | £9.97 / month, incl. VAT | → seed `plan_entitlements.stripe_price_id` for `pro` |
| Centre | £19.97 / month, incl. VAT | → seed for `centre` |

Then set them in the DB (either edit the `PLAN_ENTITLEMENTS` seed and re-run `prisma db seed`, or
`UPDATE plan_entitlements SET stripe_price_id = 'price_...' WHERE plan_id = 'pro';` etc). Until this
is done, `POST /subscriptions/checkout` correctly returns a clean 409 ("not yet configured") — no
crash, just no upgrades.

> The £1.50/card price is **not** a Stripe Price object — it's `CARD_PRICE_MINOR` in code
> (`billing.constants.ts`), charged via a dynamic Checkout line item. Nothing to configure.

### 2b. Webhook endpoint

- Add a webhook endpoint pointing at `https://<live-api-url>/webhooks/stripe`.
- Subscribe it to at least: `checkout.session.completed`, `checkout.session.expired`,
  `payment_intent.payment_failed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`.
- Copy the endpoint's **signing secret** (`whsec_...`) → Railway `STRIPE_WEBHOOK_SECRET`.

---

## 3. Railway (API) env vars 🧑

| Var | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase pooled connection |
| `DIRECT_URL` | Supabase direct connection |
| `SUPABASE_URL` | project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key |
| `STRIPE_SECRET_KEY` | **test key first** (`sk_test_...`), see step 5 |
| `STRIPE_WEBHOOK_SECRET` | signing secret from 2b |
| `WEB_APP_URL` | the live Netlify URL (CORS + Stripe redirect targets) |
| `AIRTABLE_API_KEY` | read-only Airtable PAT (`data.records:read` on the cards base) — step 4b |
| `AIRTABLE_BASE_ID` | the cards base id (`app…`) — step 4b |
| `AIRTABLE_CARDS_TABLE` | *(optional; defaults to `Card List`)* |
| `PLATFORM_ADMIN_USER_IDS` | *(optional, step 4)* |
| `SENTRY_DSN` | Sentry project DSN — enables API error monitoring (now wired). Leave unset to disable. |

**Netlify (web) env vars** — same `NEXT_PUBLIC_*` as today, plus optionally:

| Var | Value |
|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN for the web (browser + SSR errors, e.g. a failed page fetch). Leave unset to disable. |
| `SENTRY_AUTH_TOKEN` | *(optional)* Sentry auth token — only needed to upload source maps for readable stack traces; the build succeeds without it. |

---

## 4. Bootstrap the first ops admin 🧑

The fulfillment queue is gated on the `platform_admins` table (ADR 0010). To grant your print/post
team access:

1. Have each ops user sign up / log in once so they exist in Supabase auth (get their user id from
   the Supabase Auth dashboard).
2. Either set `PLATFORM_ADMIN_USER_IDS=<id1>,<id2>` in Railway and re-run the seed
   (`pnpm --filter @kudos/api exec prisma db seed`), or insert directly:
   `INSERT INTO platform_admins (id, user_id) VALUES (gen_random_uuid(), '<supabase-user-id>');`
3. They can then reach `/fulfillment` in the web app; everyone else is redirected away.

### 4b. Load the card catalog from Airtable (ADR 0011)

The catalog (`card_designs`) is synced from the Airtable "Card List" base — the real products, not
the three seeded placeholders.

1. In Airtable, create a **Personal access token** (Builder hub → Personal access tokens) with
   scope `data.records:read`, scoped to **only** the cards base. Copy the `pat…` value.
2. Set `AIRTABLE_API_KEY` (the token), `AIRTABLE_BASE_ID` (the `app…` id from the base URL), and
   `AIRTABLE_CARDS_TABLE` (the **table id** `tbl…` from the base's *grid* URL — not an
   interface-page name, and no quotes) in Railway (step 3). Redeploy.
3. As an ops admin, open **/catalog** in the web app and click **Refresh catalog from Airtable**
   (or wait for the nightly 4am sync). Only cards with `Status = Active` import; retired cards are
   deactivated automatically. The button reports created / updated / deactivated / images-copied /
   errors.
4. Artwork is copied into the `design-assets` bucket. The sync **creates that bucket itself**
   (public) if missing, so no manual step is needed — but if you pre-create it, name it exactly
   `design-assets` and make it public.

If a sync errors, the ops screen shows the real reason (ADR 0011): a **403** means the token needs
`data.records:read` and the base added under **Access** (the error also lists the base's real table
names); a **"table not found"** means `AIRTABLE_CARDS_TABLE` is wrong — use the `tbl…` id.

---

## 5. Staged verification (test mode → live) 🧑🤖

Do a full dry run on **Stripe test mode** before touching real cards:

1. Set Railway `STRIPE_SECRET_KEY` to the `sk_test_...` key and `STRIPE_WEBHOOK_SECRET` to the
   **test-mode** webhook's signing secret. Redeploy.
2. Walk the whole flow against the live-but-test-mode site:
   - Sign up a tuition-centre account → add a recipient → create + save a design (image upload
     exercises the `design-assets` bucket) → create an occasion → approve it.
   - Checkout at `/batch-orders`, pay with a Stripe **test card** (`4242 4242 4242 4242`).
   - Confirm the webhook lands: the order flips to `paid`, a message page + fulfillment job appear.
   - Personalise the card at `/messages` (video upload exercises `message-videos`), open the
     public `/r/<slug>` page, confirm it renders and the view count ticks.
   - As an ops admin, work the card through `/fulfillment`: claim → printed → posted (add a
     tracking ref) → delivered, and confirm the customer's occasion/order status follows and the
     order reaches `completed`.
   - Try a plan upgrade at `/billing` (needs the test-mode Price ids seeded) → subscription webhook
     updates the plan.
   - **Wallet (Phase 8):** at `/wallet`, top up with a test card → confirm the balance updates once
     the `checkout.session.completed` webhook lands (the same event as order checkout, tagged
     `metadata.type=wallet_topup`). Then on an unpaid order choose **Pay with wallet** → confirm the
     balance is debited and the order flips to `paid` with a fulfillment job + message page, exactly
     like a card payment.
   - **Auto-send (Phase 9):** on a Pro/Centre account with a funded wallet and a recipient that has
     a full postal address, approve an occasion with **auto-send** (postage class of your choice).
     Trigger a run out-of-band with `POST /auto-send/run` (ops-admin token) — or wait for the 7am
     cron — and confirm the wallet is debited and the card enters fulfillment. Re-run and confirm it
     is **not** sent twice. With an under-funded wallet, confirm the run leaves the occasion
     `approved` and records an `auto_send_skipped` audit entry (it resumes automatically once topped
     up). Note: auto-send makes **no** external Stripe call — the funds are already on the platform —
     so this only needs a funded wallet, not test-mode card entry.
3. When all of that passes: swap Railway to the **live** `STRIPE_SECRET_KEY` + live webhook signing
   secret, and re-seed the **live** Stripe Price ids. Redeploy. You're live.

> **Cron jobs** run automatically once the API is deployed (no setup): birthday scheduling (6am),
> auto-send (7am), and the Airtable catalog pull (4am). No extra Stripe webhook events are needed
> beyond section 2b — wallet top-ups reuse `checkout.session.completed`.

---

## 6. Recommended before real launch 🤖🧑

- **Turn on error monitoring.** Sentry is now wired into both the API (`@sentry/node`) and the web
  app (`@sentry/nextjs`) — it stays a **no-op until you set the DSN**. To activate: set `SENTRY_DSN`
  on Railway and `NEXT_PUBLIC_SENTRY_DSN` on Netlify (optionally `SENTRY_AUTH_TOKEN` on Netlify for
  readable stack traces). Server-side page errors (like the `/recipients` failure) are captured via
  the Next `onRequestError` hook; API 5xx errors via a global exception filter. Do this before real
  traffic so production errors are visible and alertable, not just buried in platform logs.
- Confirm a database backup/retention policy in Supabase (recipient data is children's PII — UK
  GDPR; the app already keeps an access audit trail, but backups/retention are a dashboard policy).
- A focused pre-launch security review of the newest, most sensitive surfaces — the public
  message endpoint and the cross-account fulfillment/platform-admin module — since these are the
  two places the usual per-account walls are deliberately down. (Full end-to-end review completed
  2026-07-17 — see the review summary; findings were the CSV upload size cap, now fixed, and this
  monitoring gap.)
