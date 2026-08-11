# 0153 — Order-guard Stripe subscription webhooks against stale redelivery

## Status

Accepted — implemented.

## Context

A full-platform review flagged a correctness gap in the Stripe subscription
webhook handler (`WebhooksService.handleSubscriptionEvent`). Stripe delivers
webhooks **at-least-once and does not guarantee order** — a redelivered or
delayed event can arrive after a newer one. The handler applied every
`customer.subscription.*` event unconditionally, upserting the `Subscription`
row and setting `Account.planId`.

The concrete failure: a subscription is cancelled
(`customer.subscription.deleted`, status `canceled`) and the account drops to
`free`. Stripe then redelivers an earlier `customer.subscription.updated`
(status `active`) — a stale event that had been delayed or retried. The old
handler would apply it, resurrect the cancelled subscription, and restore the
paid plan the customer no longer pays for. The same class of bug applies to any
out-of-order pair (e.g. a stale `active` overwriting a newer `past_due`).

The other webhook handlers in this file are already redelivery-safe via
status-guarded `updateMany` (a second delivery is a no-op). Only the
subscription handler lacked an ordering guard.

## Decision

Two guards, evaluated inside a single Serializable transaction so the
read-then-write can't race a concurrent redelivery:

1. **Ordering guard.** Persist `subscriptions.last_event_at` — the `event.created`
   timestamp of the most recent subscription event applied to the row. Drop any
   incoming event whose `event.created` is **strictly older** than
   `last_event_at`. Equal timestamps pass through, so a genuine same-second
   transition (`updated` then `deleted`) still lands and a true duplicate simply
   rewrites identical data.

2. **Terminal guard.** A Stripe subscription id never re-activates once
   cancelled — a resubscribe issues a brand-new id. So once a row's status is
   `canceled`, any non-cancel event for that id can only be stale/replayed and is
   dropped outright, independent of timestamps. This is the direct fix for the
   resurrection scenario and is robust even at second-granularity timestamp ties.

`event.created` is threaded from `handleEvent` into the handler. Dropped events
are logged (not audited); applied events keep the existing `subscription_updated`
audit entry.

Serializable (via the existing `runSerializable` helper, the codebase's standard
concurrency primitive for guarded read-then-write) replaces the previous plain
multi-statement `$transaction([...])`, so two concurrent deliveries for the same
subscription can't both read "not yet applied" and both write.

## Schema

`Subscription.lastEventAt DateTime? @map("last_event_at")` — nullable, no
backfill. Existing rows are `NULL` (unknown), treated as "no prior event
applied", so the first event after deploy establishes the baseline. Migration
`20260811120000_subscription_last_event_at`.

## Consequences

- A cancelled subscription cannot be resurrected by a stale `active` redelivery,
  and out-of-order updates no longer clobber newer state.
- On the very first event after deploy for a pre-existing subscription,
  `last_event_at` is `NULL`, so that event applies unconditionally and sets the
  baseline — correct, because it reflects Stripe's current view at that moment.
- Second-granularity ties are handled by the terminal guard for the only
  dangerous transition (canceled → active); other same-second ties are benign
  (they rewrite equivalent state).

## Alternatives considered

- **Re-fetch the subscription from Stripe on every event** to read authoritative
  current state. Rejected: adds a network round-trip and API-failure surface to
  every webhook, and the ordering guard achieves the same guarantee locally.
- **Timestamp guard alone.** Rejected as insufficient on its own: `event.created`
  is second-granularity, so a `deleted` and a stale `active` in the same second
  couldn't be ordered reliably. The terminal guard closes that gap.
