# 0114 — Click & Drop import-status readout

## Status

Accepted

## Context

After the connection probe (ADR 0113) proved the Click & Drop credential works
(HTTP 200 on a read-only GET), a second question remained: **are our cards
actually landing in the dashboard?** The probe confirms auth and the base URL,
but its response only lists the account's newest orders — and on the shared
Royal Mail account those newest orders are legacy WooCommerce imports
(`#5343`…`#5349`, the Click & Drop WooCommerce plugin's `#<order-number>`
format), not ours. Our platform stamps a different reference —
`ORD-<orderNumber>-<jobId8>` — so an operator staring at the probe body couldn't
tell whether our POSTs were arriving at all or the queue was simply empty.

The only per-card signal was `clickAndDropError`, surfaced one row at a time in
the queue, and the `clickAndDropErrors` count in `/fulfillment/counts` (ADR
0111). Neither answered the aggregate question — _how many of our jobs have
imported, how many errored, how many are still waiting_ — nor gave a concrete
reference to search for in the dashboard.

## Decision

### 1. An import-status readout endpoint

`ClickAndDropService.importStatus()` splits every `FulfillmentJob` into three
disjoint bands by its stored import state, using the same fields the sweep
writes (ADR 0095):

- **imported** — `clickAndDropOrderId` is set (Royal Mail accepted it),
- **errored** — no id, `clickAndDropError` is set (last push failed),
- **awaiting** — no id, no error (never tried; the sweep will pick it up).

It also returns up to five sampled rows per band (imported + errored), each
carrying the **exact `orderReference` we send** (`ORD-<n>-<jobId8>`), Royal
Mail's stored `orderIdentifier`, any error, a precise `importedAt` (imported
samples), and `updatedAt` (the last-failed time for error samples). An operator
copies a sampled `ORD-…` reference straight into the Click & Drop dashboard
search to confirm our orders land in the same account as the legacy `#NNNN`
ones.

- Service: `FulfillmentService.clickAndDropImportStatus()` wraps it.
- API: `GET /fulfillment/click-and-drop/import-status`, read-only, gated by
  `PlatformAdminGuard` like the rest of the fulfilment controller.
- Web: a **"Click & Drop import status"** panel on the ops fulfilment queue —
  three count pills, the sampled references, recent errors, and a ↻ Refresh
  (also refreshed after a manual per-card retry). Auto-loads on mount.

The counts are computed **even when import is disabled** (no API key): the
`awaiting` backlog is worth seeing before go-live, and the panel shows a
"not configured" chip rather than hiding.

### 2. A single source for the order reference

The reference string was previously inlined in `pushOne`. It's now
`orderReferenceFor(jobId, orderNumber)`, shared by the sweep (what we send) and
the readout (what we tell the operator to search for) so the two can never
drift.

### 3. A precise import timestamp

`FulfillmentJob.clickAndDropImportedAt` records the exact moment a card was
imported (set alongside `clickAndDropOrderId` in `pushOne`). The readout orders
imported samples by it and surfaces it as `importedAt`, so the displayed time is
the real import time rather than `updatedAt` (which any later change to the job
would move). The migration backfills existing imported cards from `updatedAt` —
the best proxy available for cards imported before the column existed.

## Consequences

- "Are our cards reaching Click & Drop?" is now answerable at a glance, with a
  copy-pasteable reference to verify in the dashboard — no waiting on a sweep or
  reading raw probe JSON.
- One additive column (`clickAndDropImportedAt`, nullable) with a backfill; the
  bands themselves come from existing columns (`clickAndDropOrderId`,
  `clickAndDropError`).
- The three counts are three `count()`s plus two small `findMany`s (capped at
  five rows each) — cheap enough to auto-load and refresh on demand.
- The imported-sample time is now exact (`clickAndDropImportedAt`), not a proxy;
  error samples still show `updatedAt` (their last-failed time). Cards imported
  before the column existed carry the backfilled `updatedAt` value.
- Covered by e2e tests (imported band with a searchable reference + exact
  `importedAt`, errored band with its message, ops-only auth).

## Alternatives considered

- **Reuse `updatedAt` as the import time.** Started here, then added
  `clickAndDropImportedAt` for a precise, stable timestamp — `updatedAt` moves on
  any later change to the job, so it can't be trusted as "imported at".
- **Fold the counts into `/fulfillment/counts`.** Rejected: that payload drives
  the queue's filter chips and is fetched on every queue render; the import
  readout is a heavier, on-demand diagnostic with sample rows, so it earns its
  own endpoint.
- **List real orders from Click & Drop via the API.** Rejected: the probe
  already shows the newest orders, and matching them back to our jobs is exactly
  what our stored `orderReference` + `clickAndDropOrderId` already give us
  locally, without a second live call.
