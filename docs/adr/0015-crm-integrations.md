# ADR 0015 — CRM integrations: a hybrid, source-agnostic recipient ingest

Status: accepted (Phases 1–3)
Date: 2026-07-18 (Phase 3 addendum: 2026-07-20)

## Context

Customers keep their contacts in CRMs — Brevo, HubSpot, GoHighLevel, and a long tail of
industry-specific systems. Re-typing or re-importing those contacts into the Recipients page by
hand is exactly the manual work Kudos exists to remove. We want to let an account bring recipients
in from wherever they already live.

Building a bespoke integration per CRM does not scale — each has its own auth (API key vs OAuth2),
data model, pagination, and rate limits, and we will never hand-build an adapter for every niche
CRM. Equally, handing the whole problem to a unified-data platform (e.g. Merge.dev) means paying
per connected account and giving up control of the mapping and of customer credentials.

## Decision: a hybrid model, three lanes into one funnel

Every integration is just a *producer* of normalized contacts. They all pour into a single
internal ingest step, so the hard part — mapping, dedupe, cap enforcement, audit — is written once.

```
Lane A  OAuth CRMs (HubSpot, GHL, …)  ─┐   via an auth platform (Nango) — deferred to a later phase
Lane B  API-key CRMs (Brevo, …)       ─┤   our own adapters
Lane C  Long tail (inbound API, CSV,  ─┤   a public front door
        Zapier)                         │
                                        ▼
                RecipientsService.ingestFromSource(accountId, source, contacts[])
                        → map → dedupe on (accountId, source, externalId) → upsert (cap-checked)
                                        ▼
                                  Recipients table
```

- **One-way only** (CRM → Kudos). No write-back; no cross-source identity merge (the same person in
  two CRMs stays two rows, keyed by source). Both are deliberate non-goals to keep this tractable.
- **Dedupe/identity:** `Recipient` gains `source` + `externalId`, unique per `(accountId, source,
  externalId)` — the same `externalId` trick the Airtable catalog sync already uses, so re-syncing
  a contact updates it instead of duplicating. Manual/CSV recipients keep `externalId = null`
  (Postgres treats NULLs as distinct, so they never collide) and still fall under the existing
  name+postcode+DOB dedupe key.
- **Ingest reuses the recipient write path.** `ingestFromSource` lives on `RecipientsService` so it
  shares the plan **recipient-cap** enforcement (Serializable, retry-on-P2034), the audit trail, and
  the cap comparison — no second, drifting copy of those rules.

## Phase 1 — the spine + the long-tail front door (this ADR)

Ships value with **no external dependency** and needs none of the deferred decisions:

- Schema: `Recipient.source` / `Recipient.externalId`; a new `AccountApiKey` model.
- `RecipientsService.ingestFromSource` — the funnel (map, dedupe on source key, cap-checked upsert,
  audit, `{created, updated, skipped, errors}` summary).
- **Per-account API keys** (`kudos_…`, only the SHA-256 hash stored; shown in full exactly once) and
  a **public `POST /integrations/contacts`** endpoint authenticated by that key — so any system,
  including a bespoke CRM's outbound webhook, can push contacts in. CSV import already rides the
  same recipient write path.
- Web: a source badge per recipient + an Integrations panel to create/copy/revoke keys.

Inbound is deliberately **lenient** on shape (e.g. non-UK postcodes accepted, DOB optional): CRM
data varies, and a contact with no DOB is still worth having — it's flagged as needing a birthday
before it can be scheduled, rather than rejected.

## Phase 2 — Brevo adapter (the API-key lane, shipped)

The first real CRM, in-house (no platform), proving a connector slots into the funnel:

- `CrmConnection` model — one per `(account, provider)`. The Brevo API key is stored
  **AES-256-GCM encrypted** (`common/crypto.service.ts`, key from `CREDENTIALS_ENCRYPTION_KEY`);
  never in plaintext, never returned.
- A mockable **`BREVO_CLIENT`** (interface + token, exactly like `CATALOG_SOURCE`) with an HTTP
  implementation (paginated `GET /v3/contacts`) and a `verifyKey` used at connect time so a bad key
  fails immediately. A `mapBrevoContact` maps a Brevo contact (+ a configurable field mapping —
  FIRSTNAME/LASTNAME default; DOB/postcode optional custom attributes) to `NormalizedContact`.
- `CrmConnectionsService`: connect (verify → encrypt → store), list (masked), disconnect, and
  **sync** (fetch → `ingestFromSource(source = "brevo")`), recording the outcome on the connection.
  A **nightly cron** re-syncs every enabled connection (5am, staggered from the others).
- Web: the Brevo card on the Integrations page becomes connect (API key + optional field mapping) →
  connected state with **Sync now** / last-synced / disconnect and an import summary.

Verified against local Postgres: encryption round-trip + tamper-detection unit tests, and Brevo e2e
(connect stores encrypted, bad key → 401, sync ingests as `source = brevo` and skips unaddressable
contacts, re-sync dedupes, cross-account scoping).

## Phase 3 — HubSpot adapter (the OAuth lane, in-house, shipped)

The first OAuth CRM. We deliberately built the OAuth **in-house** rather than standing up a
platform (Nango). The decision that mattered was "keep customer CRM tokens in our own infra" — and
having already built the hard shared parts in Phase 2 (AES-256-GCM encryption, the mockable-client
pattern, the ingest funnel), an in-house HubSpot adapter reaches that same goal with **no new
service to operate** and, critically, is **fully testable in CI against a mocked client** (a
self-hosted Nango would ship partly unverified from our sandbox). Nango earns its keep when the
OAuth-CRM count grows — switching to it later is contained, because everything still funnels through
`ingestFromSource`.

- `CrmConnection` gains an `authType` discriminator (`api_key` | `oauth`) plus OAuth columns:
  `encryptedAccessToken`, `encryptedRefreshToken`, `tokenExpiresAt`, `externalAccountId`. Both
  tokens are AES-256-GCM-encrypted at rest with the same `CREDENTIALS_ENCRYPTION_KEY`;
  `encryptedApiKey` is now nullable (null for OAuth connections). A small provider registry
  (`CRM_PROVIDERS`) maps each provider to its `authType`.
- **OAuth flow, in the API.** `GET /integrations/oauth/:provider/start` (account holder, JWT) builds
  HubSpot's consent URL carrying a **signed `state`** — the account/user id, encrypted with the
  credentials key, so the auth tag makes a forged/tampered state fail (the CSRF defence) and expires
  after 10 minutes. `GET /integrations/oauth/:provider/callback` is **public** (HubSpot redirects the
  browser to it, no JWT — the signed state is what we trust): it validates the state, exchanges the
  code for tokens via a mockable **`HUBSPOT_CLIENT`**, stores them encrypted, and always redirects
  back to the web app's Integrations page flagged `?connected=` / `?error=` (never an exception page).
- **Just-in-time refresh.** `sync` branches on `authType`; the HubSpot path refreshes the access
  token (and persists the new tokens) when it's missing or within 60s of expiry, then fetches
  (paginated `GET /crm/v3/objects/contacts`, requesting the mapped property names) and funnels
  through `ingestFromSource(source = "hubspot")`. The nightly cron re-syncs it like any other
  connection. `mapHubSpotContact` maps HubSpot properties (firstname/lastname/email defaults;
  date_of_birth/address configurable, ISO **and** epoch-ms dates parsed) to `NormalizedContact`.
- **Scopes:** read-only `crm.objects.contacts.read` — one-way import only, no write-back (per this
  ADR). Env: `HUBSPOT_CLIENT_ID` / `HUBSPOT_CLIENT_SECRET` / `HUBSPOT_REDIRECT_URI`, all optional;
  unset ⇒ connecting HubSpot returns a clean "not enabled" (same posture as Brevo's encryption key).
- Web: HubSpot's card becomes a real connector — "Connect" bounces through HubSpot's consent and
  back; connected state has Sync now / last-synced / disconnect and an import summary. The return
  flag is read server-side (`searchParams`) so the banner renders without a hydration mismatch.

Verified against local Postgres: HubSpot mapper unit tests (name-required, ISO/epoch date parsing,
custom mapping) and HubSpot OAuth e2e (start builds a signed-state URL, callback stores tokens
encrypted, forged/denied state → error redirect with no connection, sync ingests as
`source = hubspot` skipping unaddressable, re-sync dedupes, **expired token triggers a refresh**,
cross-account scoping). Full suite green; the compiled server boots and serves `/health`.

## Deferred (not needed for Phase 1–3)

- **Nango / a platform for OAuth CRMs** — revisit when we're onboarding many OAuth CRMs and
  hand-writing each one's OAuth quirks stops paying off. In-house stays the choice while the count is
  small. If adopted, self-host remains favoured (keeps CRM tokens in our infra).
- **GoHighLevel** (the second OAuth CRM) — a new adapter slotting into the same funnel; no new write
  path. `externalAccountId` is reserved on `CrmConnection` for displaying the connected portal/account.
- Field-mapping UI, Zapier app, and provider-driven incremental/webhook syncs — later phases.

## Consequences

- Adding a CRM later is "teach a new producer to emit `ExternalContact[]`", not a new write path.
- Storing customers' inbound API keys (and, later, CRM tokens) is sensitive: keys are stored only as
  a hash and revocable; the deferred self-host-Nango option keeps CRM tokens in our infra.
- Importing recipients (often children's PII) from a third party adds a data-flow worth a
  controller/processor line in customer terms — a business action, flagged here, not a code task.
