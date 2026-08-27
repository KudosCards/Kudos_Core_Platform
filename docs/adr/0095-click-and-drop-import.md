# 0095 — Royal Mail Click & Drop order import

## Status

Accepted

## Context

Operators dispatch cards through Royal Mail **Click & Drop** — its web dashboard,
where they batch orders, buy postage, print labels, and hand off to Royal Mail.
They expected paid Kudos orders to appear in that dashboard queue "to process".
They didn't, and the Click & Drop channel showed "Not connected".

Investigation found two Royal Mail products in play, pointed at different things:

- **Shipping API v4** (`/api/v4/shipments`) — what the platform already
  integrated with (ADR 0072). It creates a _finished shipment_ server-side (buys
  postage, returns tracking + label) and **bypasses the Click & Drop dashboard**.
  It's a manual ops step ("Dispatch via Royal Mail" on a printed card) and was
  never enabled (`ROYAL_MAIL_API_KEY` unset).
- **Click & Drop Orders API** (`/api/v1/orders`) — the channel the operator set
  up, with its own authorization key. Orders are _imported_ into the dashboard
  queue. Its "Not connected" status is normal for a push-import channel (it just
  waits for orders to be POSTed to it); nothing in the platform was POSTing.

So no code path made a paid order populate Click & Drop. This ADR adds that
import path (and a follow-up, ADR 0096, finishes the Shipping API path — the
operator wants both).

## Decision

Import each paid card into the operator's Click & Drop dashboard queue via the
Click & Drop Orders API — **one order per card** (each recipient's address).

1. **Mockable client, real-or-no-op.** `ClickAndDropClient` (interface) +
   `HttpClickAndDropClient` + `NoopClickAndDropClient`, wired by a provider that
   returns the no-op unless `CLICK_AND_DROP_API_KEY` is set — mirroring the
   Shipping / Stripe / Airtable pattern, so tests override it and never hit the
   network. Config: `CLICK_AND_DROP_API_KEY`, `CLICK_AND_DROP_API_BASE_URL`, and
   optional per-postage-class service codes (omitted by default so the operator
   picks the service in the dashboard).

2. **A background sweep does the pushing — the money path is untouched.** Rather
   than couple the Click & Drop call into all four ways an order gets paid
   (Stripe webhook / wallet / auto-send / RTS re-send), a `@Cron` sweep every 5
   minutes imports any FulfillmentJob not yet in Click & Drop. This decouples a
   Royal Mail outage from payment entirely (a network call never rides a payment
   transaction), and gives retries for free. Two new columns on `FulfillmentJob`:
   `clickAndDropOrderId` (the idempotency guard — a card is pushed at most once)
   and `clickAndDropError` (the last failure, shown in the ops queue).

3. **Backoff + manual retry.** The sweep imports never-tried cards immediately and
   auto-retries a previously-failed card only once its error has aged past 30
   minutes, so a transient Royal Mail blip self-heals without spamming. An ops
   "Retry" action (`POST /fulfillment/jobs/:id/click-and-drop`) forces an
   immediate re-attempt; the queue shows an "In Click & Drop" / "import failed"
   chip when import is enabled (`GET /fulfillment/click-and-drop-status`).

## Consequences

- Paid cards flow into the operator's Click & Drop dashboard queue automatically
  (within a sweep interval), where they process them as they already do.
- Payment is never blocked or failed by Click & Drop — the sweep is fully out of
  band, idempotent, and self-retrying.
- **Unverifiable in this sandbox** (no Royal Mail egress). The client follows the
  documented Click & Drop Orders API, but the exact fields, auth scheme, weight/
  format identifiers, and service codes MUST be verified live after deploy with
  the real key — the same caveat as Stripe and the Shipping API. First live check:
  run a test order and adjust the payload to whatever the API returns.
- The Shipping API v4 direct-dispatch path is unchanged and complementary; ADR
  0096 finishes enabling it.
