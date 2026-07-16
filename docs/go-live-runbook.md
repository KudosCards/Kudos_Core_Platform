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

- `DATABASE_URL` = the **pooled** connection (app runtime).
- `DIRECT_URL` = the **direct** connection (migrations). Both go in Railway (step 3).

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
| `SENTRY_DSN` | *(optional)* |

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
2. Set `AIRTABLE_API_KEY` (the token) and `AIRTABLE_BASE_ID` (the `app…` id from the base URL) in
   Railway (step 3). Redeploy.
3. As an ops admin, open **/catalog** in the web app and click **Refresh catalog from Airtable**
   (or wait for the nightly 4am sync). Only cards with `Status = Active` import; retired cards are
   deactivated automatically. The button reports created / updated / deactivated / images-copied /
   errors.
4. Artwork is copied into the `design-assets` bucket, so make sure that bucket exists (step 1a)
   before the first sync.

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
3. When all of that passes: swap Railway to the **live** `STRIPE_SECRET_KEY` + live webhook signing
   secret, and re-seed the **live** Stripe Price ids. Redeploy. You're live.

---

## 6. Recommended before real launch 🤖🧑

- A focused pre-launch security review of the newest, most sensitive surfaces — the public
  message endpoint and the cross-account fulfillment/platform-admin module — since these are the
  two places the usual per-account walls are deliberately down. (Can be run on request.)
- Confirm a database backup/retention policy in Supabase (recipient data is children's PII — UK
  GDPR; the app already keeps an access audit trail, but backups/retention are a dashboard policy).
