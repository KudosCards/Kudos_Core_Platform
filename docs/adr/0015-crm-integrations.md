# ADR 0015 — CRM integrations: a hybrid, source-agnostic recipient ingest

Status: accepted (Phase 1)
Date: 2026-07-18

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

## Deferred (not needed for Phase 1–2)

- **Build vs platform for OAuth CRMs.** Chosen direction: Nango for the OAuth plumbing (auth + token
  refresh + a proxy), our own mapping/sync. **Cloud vs self-host is an open decision** — self-host
  keeps customer tokens in our infra (favoured given recipients are often children's data); cloud is
  faster to start but makes Nango a processor needing a DPA. Decide when Phase 3 starts.
- **First OAuth CRM** (HubSpot vs GoHighLevel) — decide at Phase 3.
- Field-mapping UI, Zapier app, and Nango-driven incremental/webhook syncs — later phases.

## Consequences

- Adding a CRM later is "teach a new producer to emit `ExternalContact[]`", not a new write path.
- Storing customers' inbound API keys (and, later, CRM tokens) is sensitive: keys are stored only as
  a hash and revocable; the deferred self-host-Nango option keeps CRM tokens in our infra.
- Importing recipients (often children's PII) from a third party adds a data-flow worth a
  controller/processor line in customer terms — a business action, flagged here, not a code task.
