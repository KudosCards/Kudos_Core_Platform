# 0121 — Automated delivery registration from Royal Mail tracking

## Status

Accepted

## Context

The fulfillment state machine (ADR 0010) runs `pending → printed → posted →
delivered`. Everything up to `posted` is automated — a card is printed, then
either marked posted manually or dispatched via the Royal Mail Shipping API
(ADR 0072), which buys postage and stores a **tracking number**. But the final
hop, `posted → delivered`, was **manual only**: an operator had to click "Mark
delivered" on every card. We were already holding the tracking number and never
reading it back, so cards sat in `posted` indefinitely, the buyer-facing order
never rolled up to `completed`, and "delivered" was really "we stopped looking".

We wanted the carrier to close the loop: poll tracking, and when Royal Mail says
delivered, register it — through the same audited transition an operator uses,
with the same downstream cascade.

## Decision

### 1. A read-only tracking method on the Royal Mail client

`RoyalMailClient` gains `getTrackingStatus(trackingNumber)` →
`{ status: "delivered" | "in_transit" | "unknown", deliveredAt, rawStatus }`.
The `HttpRoyalMailClient` calls the tracking resource under the same base URL and
API key as `createShipment` (no new credential — go-live wiring is the existing
`ROYAL_MAIL_API_KEY` step). It is deliberately forgiving: a **404** (tracking not
yet visible) returns `unknown`, not an error, so a not-yet-scanned item is simply
retried next sweep; only a real transport error or a non-404 HTTP failure throws.
The `NoopRoyalMailClient` rejects, matching `createShipment` — the poll never
reaches it because it gates on `enabled` first.

Status text is normalised by a pure, unit-tested `normaliseTrackingStatus`. It
matches the **past-tense word "delivered"**, not the stem "deliver", so
pre-delivery states that share the stem — "Out for delivery", "Ready for
delivery", "Attempted delivery" — stay `in_transit` and never prematurely close a
card. The exact tracking path/field names are account-specific and, like the rest
of the RM integration, MUST be verified against the sandbox before go-live; the
normalised contract above is what the rest of the app depends on.

### 2. The poll, through the existing state machine

`FulfillmentService.pollCarrierDeliveries()` sweeps `posted` jobs that carry a
tracking reference (oldest-posted first, capped at 200 per run), asks the carrier
each one's state, and for any reported delivered runs the **same** private
`applyTransition(..., "delivered", ...)` an operator's "Mark delivered" uses — so
`deliveredAt`, the `OrderRecipient`/`Occasion` status cascade, and the order's
`fulfilling → completed` roll-up all happen exactly once, status-guarded against a
concurrent manual transition. `applyTransition` gained an optional `deliveredAt`
override so the poll stamps the **carrier's** delivery time when RM returns one
(falling back to now). The transition is audited against the system actor
`system:delivery-poll`, mirroring `system:auto-send` / `system:stripe-webhook`.

A per-card tracking error is counted and skipped — the card stays `posted` and is
retried next run — so one bad lookup never halts the sweep.

### 3. Schedule + on-demand trigger

`DeliveryPollService` owns an hourly cron (`35 * * * *`, offset from the other
fulfillment crons) that no-ops when shipping automation is off, mirroring
`DispatchReminderService`'s fire-and-gate shape. The work is also exposed as
`POST /fulfillment/poll-deliveries` (PlatformAdminGuard) so an operator can force
a sweep and confirm the wiring, and so it's testable over HTTP.

### 4. Manual stays the fallback

Single "Mark delivered" (`transition`) and bulk "Mark delivered"
(`bulkTransition`, which already accepts `delivered`) are unchanged. With no RM
key the poll is inert and ops register delivery by hand exactly as before.

## Consequences

- Posted cards reach `delivered` on their own once RM is live, and orders roll up
  to `completed` without an operator touching each card.
- No schema change — `deliveredAt` and `trackingReference` already existed; the
  poll only reads what dispatch already wrote.
- No new credential or env var — the poll reuses the shipping key and base URL.
- Off by default: until `ROYAL_MAIL_API_KEY` is set the cron no-ops and the
  endpoint reports `{ checked: 0, ... }`; today's manual flow is untouched.
- The carrier's own delivery time is preserved (not the poll's observation time),
  so `deliveredAt` is accurate for reporting.
- Covered by a unit spec (`normaliseTrackingStatus` incl. the "Out for delivery"
  false-positive, and the HTTP client's delivered/in-transit/404/error paths) and
  an e2e (delivered advances + carrier time + `completed` roll-up + system-actor
  audit; in-transit stays posted; lookup error counted and left posted; ops-only
  auth).

## Alternatives considered

- **A Royal Mail delivery webhook instead of polling.** Rejected for now: the
  Click & Drop/Shipping accounts aren't set up to receive push callbacks, and an
  inbound public endpoint is more surface than an hourly outbound read. The client
  seam means a webhook can replace the poll later without touching the state
  machine.
- **Stamp `deliveredAt = now` on every auto-registration.** Rejected: RM returns
  the actual delivery time; using it keeps reporting honest. `now` is only the
  fallback when the carrier omits a timestamp.
- **Match "deliver" broadly.** Rejected outright — it reads "Out for delivery" as
  delivered and closes cards a day early. The past-tense match is the whole point.
