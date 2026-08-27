# 0072 — Royal Mail Shipping API: fulfillment automation

## Status

Accepted

## Context

Turning a paid order into a posted card was entirely manual: an operator marked
a card `printed`, then `posted`, pasting a tracking number they'd copied from
Royal Mail Click & Drop by hand (if at all). Royal Mail's **Shipping API v4**
(`api.parcel.royalmail.com`, the Click & Drop / Intersoft platform) can do that
programmatically — create a shipment, buy the postage, allocate a tracking
number, and return a label — so the ops queue can dispatch a card in one click
and the buyer gets a real tracking link.

(Note: this is the _shipping_ API, not address lookup. House-level address
autocomplete needs Royal Mail's PAF **data** via a licensed reseller — a
separate integration, ADR 0071 follow-up.)

## Decision

**A small, mockable client behind a stable interface.** `RoyalMailClient` has
one method, `createShipment(input) → { trackingNumber, labelUrl }`. A
`ROYAL_MAIL_CLIENT` provider wires the real `HttpRoyalMailClient` only when
`ROYAL_MAIL_API_KEY` is set, otherwise a `NoopRoyalMailClient` (so the app boots
and ops keep dispatching manually). It's overridable in tests exactly like
`STRIPE_CLIENT` / `DESIGN_ASSET_STORAGE_CLIENT` — **no test ever calls the real
Royal Mail API**. This mirrors every other external integration in the codebase.

**Dispatch from the fulfillment queue.** New ops-only endpoints:
`GET /fulfillment/shipping-status` (is automation wired?), `POST
/fulfillment/jobs/:id/dispatch` (one card), and `POST /fulfillment/jobs/dispatch`
(bulk). Dispatch loads a **printed** job's address + recipient + postage, calls
the client, and on success transitions the job to `posted` with the tracking
number and label URL stored (`FulfillmentJob.labelUrl`, new nullable column).
The existing manual "Mark posted" path stays as the fallback.

**Ordering and safety.** The network call happens **before** the DB transition
and **outside** any transaction — a real HTTP call must never hold a Postgres
transaction open. Only a successful shipment transitions the job. If the
transition then finds the job already moved on (a double-click), we've created a
shipment we didn't record, so that surfaces as a `409` for the operator to
reconcile rather than being silently dropped. Bulk dispatch is per-job
try/catch: one bad address doesn't abort the run, and the summary reports
`{ dispatched, failed }`.

**Tracking flows to the customer.** The dispatch email (already fired on
`posted`, grouped per order) now lists each card with a Royal Mail "track it"
link when it has a tracking number. The ops queue shows the tracking reference
and a "Print label" link on dispatched cards.

## Consequences

- One click in the ops queue creates the shipment, buys postage, and gets a
  tracking number + label; the buyer is emailed a live tracking link. Tracking
  also feeds naturally into the existing Returned-to-Sender flow.
- Nothing changes until `ROYAL_MAIL_API_KEY` is set — the integration ships dark
  and is enabled by adding the credential in Railway, the same pattern as
  Airtable and the Stripe price ids.
- **Verify-after-deploy caveat (as with Stripe):** the exact v4 wire format —
  service codes, weight units, label retrieval — is account-specific and MUST
  be confirmed against Royal Mail's sandbox before go-live. The
  `HttpRoyalMailClient` request/response shape follows the documented structure
  but is the one part not covered by automated tests (which run against the
  mock). Recommend pointing `ROYAL_MAIL_API_BASE_URL` at the sandbox and
  dispatching a test card end-to-end before switching to live.
- Tests: `royal-mail-dispatch` e2e against the mocked client covers a successful
  dispatch (shipment created, tracking + label stored, posted, dispatch email
  carries the tracking number), the not-yet-printed guard (`409`), bulk
  dispatch, and platform-admin auth.
