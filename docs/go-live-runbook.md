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

### 1a. Storage buckets 🤖

Two **public-read** buckets are used (uploads go direct from the browser via signed URLs; the
public read is what lets a saved design / message video render later):

| Bucket | Used by | Enforced limits |
|---|---|---|
| `design-assets` | card designer image uploads (Phase 2) + Airtable artwork copies | `allowedMimeTypes`: image/png, image/jpeg, image/webp, image/gif · `fileSizeLimit`: 10 MB |
| `message-videos` | message-page video uploads (Phase 4) | `allowedMimeTypes`: video/mp4, video/quicktime, video/webm · `fileSizeLimit`: 50 MB |

> **Now automatic.** On every production boot the API creates both buckets (public) with exactly
> the limits above and re-applies them if a bucket already exists — see
> `BUCKET_CONFIGS` / `StorageService.onApplicationBootstrap` in `storage.service.ts`. This matters
> because the API validates the *claimed* content-type in its DTOs, but the installed Supabase SDK
> can't constrain what's actually PUT to a signed URL — the bucket's `allowedMimeTypes`/
> `fileSizeLimit` are the real enforcement (see ADR 0009). Nothing to create by hand; if you *do*
> pre-create them in the dashboard, just name them exactly `design-assets` / `message-videos` and
> the boot step will bring their limits into line. Requires `SUPABASE_URL` +
> `SUPABASE_SERVICE_ROLE_KEY` (already set for the app).

### 1b. Auth

- Confirm the project's email auth (or whichever providers you want) is enabled — the app uses
  `@supabase/ssr` session cookies.
- No JWT secret to copy anywhere: the API verifies session tokens against the project's JWKS
  endpoint, so it keeps working automatically if Supabase rotates its signing key (ADR 0005).
- **Site URL (needed for signup confirmation, ADR 0080).** In Authentication → URL Configuration
  → **Site URL**, set the live web app origin — the **custom domain** (e.g.
  `https://kudos-cards.co.uk`), *not* the `*.netlify.app` URL. This is the fallback base Supabase
  uses for the signup-confirmation email. If it's left as the Netlify URL, confirmation links go
  to the wrong origin and the new account never gets created (the pending-account stash lives on
  the domain the user registered on). Also set the web env `NEXT_PUBLIC_SITE_URL` to the same
  value (env table below) so the confirmation redirect is deterministic.
- **Redirect URLs (needed for signup confirmation + operator set-password + password reset,
  ADRs 0051 & 0080).** In Authentication → URL Configuration → **Redirect URLs**, add
  `${WEB_APP_URL}/auth/confirm`, `${WEB_APP_URL}/admin-set-password` and
  `${WEB_APP_URL}/reset-password` — using the **custom domain** for `${WEB_APP_URL}`. (Adding a
  wildcard such as `${WEB_APP_URL}/**` also covers these.) The signup-confirmation, operator-invite
  and forgot-password emails send Supabase auth links that redirect to these pages; Supabase
  **rejects** any `redirectTo` not on this allow-list — and silently falls back to the Site URL —
  so without them the links dead-end or land on the wrong domain. (Same class of one-time dashboard
  step as the Stripe/HubSpot redirect URIs.)

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

**Fully automated (recommended): let the script create the Prices *and* wire them in.**
Run it where the credentials already live (so no secret is shared) — on Railway:
`railway run pnpm --filter @kudos/api run setup:stripe-plans`. It creates the Pro/Centre
Products + monthly Prices (£9.97 / £19.97, GBP) in whichever mode `STRIPE_SECRET_KEY` belongs to
and writes their ids to `plan_entitlements`. It's idempotent (keyed on a Stripe `lookup_key`), so
re-running is safe. Use the **live** key when you're ready for real subscriptions.

Or wire them by hand. **Env-driven (test-mode vs live is just a var swap):**
set `STRIPE_PRICE_ID_PRO` and `STRIPE_PRICE_ID_CENTRE` in Railway (step 3) and run the seed —
`pnpm --filter @kudos/api exec prisma db seed`. The seed reads those vars and writes each plan's
`stripe_price_id`; leaving a var unset preserves whatever is already stored (so a reseed never wipes
a live price). *Quick alternative:* `UPDATE plan_entitlements SET stripe_price_id = 'price_...'
WHERE plan_id = 'pro';` (and `centre`). Until this is done, `POST /subscriptions/checkout` correctly
returns a clean 409 ("not yet configured") — no crash, just no upgrades.

> Swapping test-mode → live later is then just: change the two `STRIPE_PRICE_ID_*` vars to the live
> `price_...` ids and re-run the seed (alongside the `STRIPE_SECRET_KEY`/webhook-secret swap in
> step 5).

> The £2.50/card price is **not** a Stripe Price object — it's `CARD_PRICE_MINOR` in code
> (`billing.constants.ts`), charged via a dynamic Checkout line item. Nothing to configure.

### 2b. Webhook endpoint

- Add a webhook endpoint pointing at `https://<live-api-url>/webhooks/stripe`.
- Subscribe it to at least: `checkout.session.completed`, `checkout.session.expired`,
  `payment_intent.payment_failed`, `invoice.paid`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`.
  (`invoice.paid` is what attaches the card order's VAT invoice PDF — see 2c.)
- Copy the endpoint's **signing secret** (`whsec_...`) → Railway `STRIPE_WEBHOOK_SECRET`.

### 2c. VAT receipts for card orders (ADR 0102)

Card orders, guest one-off purchases **and wallet top-ups** now ask Stripe to generate
a proper **VAT invoice** per purchase (`invoice_creation` on the Checkout Session),
exactly like subscriber invoices — so Stripe is the single source of truth for the
company/VAT details on every receipt. (A wallet-paid *order* has no charge of its own —
its VAT receipt is the **top-up** invoice, shown on `/wallet`; see ADR 0103.) Nothing to
switch on in code, but confirm on the Stripe account:

- **Business details + VAT number** are set under **Settings → Business details** (name,
  address, VAT registration number). These print on the invoice; without the VAT number it
  won't be a valid VAT receipt.
- `invoice.paid` is enabled on the webhook endpoint (step 2b). On that event we store the
  invoice's hosted URL + **PDF** on the order; the buyer downloads it from the order page
  ("VAT receipt → Download PDF").
- *(Optional)* Turn on **Settings → Customer emails → "Successful payments / invoices"** so
  Stripe also emails the receipt/invoice — this is how **guest** buyers (no account, no order
  page) receive theirs.
- Subscribers are unchanged: they still download their VAT invoices from the Stripe
  **billing portal** ("Manage billing" on `/billing`).

---

## 3. Railway (API) env vars 🧑

| Var | Value |
|---|---|
| `NODE_ENV` | `production` |
| `TRUST_PROXY_HOPS` | number of proxy hops in front of the API, so per-IP rate limiting keys on the real client, not the edge proxy. **`1` for Railway's edge** (the default); `2` if a CDN/WAF sits in front; `0` to disable. **Never `true`.** Verify `req.ip` resolves the real client IP on staging before trusting it (ADR 0133) |
| `DATABASE_URL` | Supabase pooled connection |
| `DIRECT_URL` | Supabase direct connection |
| `SUPABASE_URL` | project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key |
| `STRIPE_SECRET_KEY` | **test key first** (`sk_test_...`), see step 5 |
| `STRIPE_WEBHOOK_SECRET` | signing secret from 2b |
| `STRIPE_PRICE_ID_PRO` | Pro plan's Stripe `price_...` id (test-mode first) — read by the seed, step 2a |
| `STRIPE_PRICE_ID_CENTRE` | Centre plan's Stripe `price_...` id (test-mode first) — read by the seed, step 2a |
| `WEB_APP_URL` | the live web app origin — the **custom domain** (e.g. `https://kudos-cards.co.uk`), used for CORS, Stripe redirects, and the auth-email links. **Must be a valid `http(s)://` URL** — a scheme typo now fails the boot loudly (ADR 0081) |
| `CORS_ALLOWED_ORIGINS` | *(optional)* comma-separated extra browser origins allowed to call the API beyond `WEB_APP_URL` (e.g. `https://www.kudos-cards.co.uk`). The allow-list is `[WEB_APP_URL, …these]`, so one wrong value can't lock the whole app out (ADR 0081) |
| `CORS_ALLOWED_ORIGIN_SUFFIXES` | *(optional)* comma-separated origin suffixes to allow, for dynamic hosts like Netlify deploy previews (e.g. `--kudos-cards.netlify.app`) |
| `AIRTABLE_API_KEY` | read-only Airtable PAT (`data.records:read` on the cards base) — step 4b |
| `AIRTABLE_BASE_ID` | the cards base id (`app…`) — step 4b |
| `AIRTABLE_CARDS_TABLE` | *(optional; defaults to `Card List`)* |
| `PLATFORM_ADMIN_USER_IDS` | *(optional, step 4)* |
| `CLICK_AND_DROP_API_KEY` | *(optional, step 4c-i)* Click & Drop API authorization key — enables auto-import of paid cards into the Click & Drop dashboard queue. Unset = off. |
| `CLICK_AND_DROP_SERVICE_CODE_FIRST` / `_SECOND` | *(optional, step 4c-i)* Click & Drop service codes per postage class; unset = operator picks in the dashboard. |
| `ROYAL_MAIL_API_KEY` | *(optional, step 4c-ii)* Shipping API v4 key — enables the in-Kudos "Dispatch (Royal Mail)" action. Unset = manual dispatch. |
| `ROYAL_MAIL_SERVICE_CODE_FIRST` / `_SECOND` | *(optional, step 4c-ii)* Shipping API service-code overrides (defaults `TPN01`/`TPS01`) — confirm against your account. |
| `ARRIVAL_NOTIFICATIONS_ENABLED` | *(optional, step 4d)* `true`/`1` enables the daily estimated-arrival email for untracked stamped post (marks cards delivered-estimated + emails the buyer). Off by default. |
| `ARRIVAL_FIRST_CLASS_WORKING_DAYS` / `_SECOND_CLASS_WORKING_DAYS` | *(optional, step 4d)* Expected transit in working days (defaults 1 / 3). |
| `ARRIVAL_MAX_POSTED_AGE_DAYS` | *(optional, step 4d)* Recency window bounding the arrival sweep (default 14) — stops a historical backlog being emailed/completed at once. |
| `BREVO_ARRIVAL_TEMPLATE_ID` | *(optional, step 4d)* Brevo template for the "should have arrived" email; unset = branded HTML fallback. |
| `SENTRY_DSN` | Sentry project DSN — enables API error monitoring (now wired). Leave unset to disable. |

**Netlify (web) env vars** — same `NEXT_PUBLIC_*` as today, plus optionally:

| Var | Value |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | the live web app origin — the **custom domain** (e.g. `https://kudos-cards.co.uk`). Makes the signup-confirmation redirect deterministic; must match the Supabase Site URL / Redirect allow-list (step 1b, ADR 0080). |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN for the web (browser + SSR errors, e.g. a failed page fetch). Leave unset to disable. |
| `SENTRY_AUTH_TOKEN` | *(optional)* Sentry auth token — only needed to upload source maps for readable stack traces; the build succeeds without it. |

### Health checks — point Railway at liveness, not the database 🧑

The API exposes two probes:

- **`GET /health`** — *liveness*. Returns `{ "status": "ok" }` if the process is up. It has **no
  external dependencies** (no database ping). **Set Railway's healthcheck path to `/health`.**
- **`GET /health/ready`** — *readiness*. Pings the database; returns Terminus health JSON. Use it for
  monitoring / uptime checks and manual smoke tests — **not** as the deploy gate.

Why: a deploy healthcheck that pings the DB turns a *transient* database blip (e.g. a provider
"outbound connectivity" incident) into a **failed deploy** — the app is fine, it just briefly can't
reach Postgres, so a healthy new version can't roll out and running instances risk being killed.
Gating on liveness decouples "is the app up?" from "is the DB reachable right now?". If a deploy is
genuinely misconfigured (wrong `DATABASE_URL`), you'll see it immediately in Sentry and on the first
request, and `GET /health/ready` will report the database `down`.

If a deploy ever fails **only** at `Network › Healthcheck` while `Build`/`Deploy` succeed, check the
provider's status page for a networking incident before suspecting the code — that signature is a
DB/connectivity problem, not a build defect. Retry the deploy once the incident clears.

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

### 4c. Royal Mail dispatch — two independent integrations (ADR 0072/0095/0096)

The platform can hand a paid card to Royal Mail two ways. They're independent — enable either, both,
or neither. Both are **off until their key is set**, and both make live calls that can only be
verified after deploy (this sandbox has no Royal Mail egress).

**(i) Click & Drop order import** (ADR 0095) — each paid card auto-appears in your **Click & Drop
dashboard** queue, where you batch, buy postage, print labels and dispatch as normal. This is the
"orders show up for us to process" flow.

- Set `CLICK_AND_DROP_API_KEY` in Railway (Settings → Integrations → your "Click & Drop API"
  integration → the authorization key). Optionally `CLICK_AND_DROP_API_BASE_URL` (defaults to the
  live host) and `CLICK_AND_DROP_SERVICE_CODE_FIRST` / `_SECOND` (leave unset to pick the service in
  the dashboard).
- A background sweep imports every paid card within ~5 minutes (nothing to trigger). The ops
  `/fulfillment` queue shows **✓ In Click & Drop** per card, or **⚠️ import failed → Retry** with
  the exact Royal Mail error.
- **First live check:** run a test order → wait ~5 min → confirm it lands in Click & Drop. If it's
  rejected, the reason is on the card in the ops queue (and in the Railway log line
  `Click & Drop import failed for job …`); adjust the payload/service codes to match.

**(ii) Shipping API v4 direct dispatch** (ADR 0072) — an operator clicks **Dispatch (Royal Mail)** on
a *printed* card in `/fulfillment` and the platform creates the shipment server-side (buys postage,
stores tracking + label, emails the buyer the tracking link). No Click & Drop dashboard involved.

- Set `ROYAL_MAIL_API_KEY` in Railway. Optionally `ROYAL_MAIL_API_BASE_URL` (defaults to the live
  host). The service codes default to `TPN01` (1st) / `TPS01` (2nd) and are **account-specific** —
  override them **without a redeploy** via `ROYAL_MAIL_SERVICE_CODE_FIRST` /
  `ROYAL_MAIL_SERVICE_CODE_SECOND` once you've confirmed your account's real codes.
- The "Dispatch (Royal Mail)" action appears only when the key is set (`GET
  /fulfillment/shipping-status`); until then ops mark cards posted manually.
- **First live check:** on a printed card, click Dispatch and confirm a shipment is created with a
  real tracking number + label. A wrong service code is the most likely first failure — the error
  (status + Royal Mail's message) surfaces to the operator; fix it via the env override above.
- **Automated delivery registration** (ADR 0121): once the key is set, an hourly poll reads the
  tracking of every `posted` card and auto-advances the delivered ones to `delivered` (stamping the
  carrier's delivery time and rolling the order up to `completed`) — no operator click needed. Manual
  "Mark delivered" stays available as the fallback. Force a sweep to verify wiring with `POST
  /fulfillment/poll-deliveries` (returns `{ checked, delivered, failed }`). No extra credential — it
  reuses `ROYAL_MAIL_API_KEY` and the base URL. Confirm the tracking resource path/fields against your
  account in the sandbox, same as the dispatch call.

### 4d. Estimated-arrival emails — for untracked stamped post (ADR 0124)

Standard letter post on stamps isn't tracked, so the delivery poll (4c) has no event to react to. For
stamped mail, enable the **estimated-arrival** email instead: a daily 09:00 UTC sweep estimates each
`posted` card's arrival from its posting date + the postage class's transit (working days, UK
holiday-aware), and once that's passed marks the card **delivered (estimated)** — rolling the order up
to `completed` — and emails the buyer an honest *"your card should have arrived"* note (never "was
delivered").

- **Opt-in:** set `ARRIVAL_NOTIFICATIONS_ENABLED=true` in Railway. It's off by default because it both
  emails customers and advances order state on an estimate.
- **Tune (optional):** `ARRIVAL_FIRST_CLASS_WORKING_DAYS` (default 1) / `ARRIVAL_SECOND_CLASS_WORKING_DAYS`
  (default 3) — Royal Mail's own aims; `ARRIVAL_MAX_POSTED_AGE_DAYS` (default 14) bounds the sweep so
  enabling it can't email/complete a historical `posted` backlog in one go. Optional Brevo template
  `BREVO_ARRIVAL_TEMPLATE_ID`, else the branded HTML fallback.
- **First check:** post a test card, backdate isn't needed live — enable, then force a run with `POST
  /fulfillment/notify-arrivals` (returns `{ checked, notified }`) once a card is past its estimated
  arrival, and confirm it flips to delivered + the buyer receives the "should have arrived" email.
- This is independent of Royal Mail's API — it needs **no** `ROYAL_MAIL_API_KEY`. If you later move to a
  tracked service, the poll in 4c takes over with real delivery events.

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
- **Confirm a database backup/retention policy in Supabase** 🧑 (recipient data is children's PII —
  UK GDPR; the app already keeps an access audit trail, but backups/retention are a dashboard
  policy). Concretely, in the Supabase dashboard:
  - **Database → Backups:** confirm daily backups are on. On Pro, enable **Point-in-Time Recovery
    (PITR)** so you can restore to any moment (not just the nightly snapshot) — worth it once real
    orders and payments are flowing, since a bad migration or accidental delete is otherwise only
    recoverable to the last nightly backup. Note the retention window (7 days default; extendable).
  - **GDPR retention** is a *policy* decision, not just a backup one: agree how long a delivered
    order's recipient address is kept and whether recipients are purged after a period of
    inactivity. The audit trail (`audit_logs`) already records every access to a recipient's PII;
    pair it with a documented retention period. A data-subject **erasure** request today means
    deleting the `recipient` row (cascades to their occasions/orders) — fine for launch, but worth
    a short written procedure before scale.
  - **Storage** is backed up separately from Postgres — the `design-assets`/`message-videos`
    buckets hold uploaded artwork and personalised videos. For launch the risk is low (assets are
    regenerable/re-uploadable and the catalog re-syncs from Airtable), but note it so it isn't a
    surprise.
- **Account security for the dashboards themselves** — 2FA, who still has access, branch
  protection, and which keys to rotate if one is ever exposed. See
  [`account-security-checklist.md`](./account-security-checklist.md). Nothing in the codebase
  protects against someone logging into Railway or Stripe as you, which makes this the highest-
  value item on the list and the only one no commit can cover.
- A focused pre-launch security review of the newest, most sensitive surfaces — the public
  message endpoint and the cross-account fulfillment/platform-admin module — since these are the
  two places the usual per-account walls are deliberately down. (Full end-to-end review completed
  2026-07-17 — see the review summary; findings were the CSV upload size cap, now fixed, and this
  monitoring gap.)
