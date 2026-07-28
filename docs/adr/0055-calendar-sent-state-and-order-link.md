# 0055 — Calendar "already sent" state + follow-the-order link

## Status

Accepted

## Context

Two gaps on the calendar (and the recipient record), raised by the user:

1. **No visual "already sent" signal.** The calendar coloured occasion pills
   purely by *type*, so a birthday whose card had already been printed and
   posted looked identical to one still weeks away. Once a card was dispatched
   there was no instant confirmation of "this one's done."
2. **No way to follow an occasion/contact through to its order.** From the
   calendar you could open an occasion, but not jump to the order it was sent
   on to see its fulfilment history.

Both facts already exist in the data:
- `Occasion.status` advances `scheduled → pending_approval → approved → queued →
  printed → posted → delivered` (or `skipped`) — the fulfilment job updates the
  occasion in lockstep with its order line (see fulfillment.service). So
  anything `queued`-or-later has been sent.
- `OrderRecipient` carries both `recipientId` and `occasionId`, so each occasion
  and each contact is joinable to the order(s) it produced.

## Decision

**1. Sent-state on the calendar (web only — no API change needed).**
`occasionProgress(status)` collapses the lifecycle to `upcoming | sent |
skipped`. The pill renders:
- **sent** — a "done" emerald fill with a ✓ tick, so a sent birthday reads
  instantly differently from an upcoming one;
- **skipped** — muted and struck through;
- **upcoming** — the existing per-type colour.

A small legend under the toolbar explains the states.

**2. Follow-the-order link (small API enrichment).**
The occasions `list` and `findOne` responses gain a nested
`order: { id, orderNumber, status } | null`, derived from the occasion's latest
`OrderRecipient → BatchOrder` (newest-first, take 1 — an occasion is consumed
into a single order, but ordering defensively covers any re-order edge). It's
`null` until the occasion has been checked out.

Surfaced in two places, both fed by the same enriched payload:
- the **calendar occasion modal** — a "View order ORD-#### →" row;
- the **recipient detail events list** — an "ORD-#### →" chip per event.

So an order can be followed from either an event (calendar) or a contact
(recipient record) without a new endpoint.

### Alternatives considered
- A dedicated `GET /recipients/:id/orders` endpoint for a full per-contact order
  history table. Rejected for now: the events list already lists a contact's
  occasions, and nesting the order link onto those covers "follow the order"
  with no new surface. The dedicated history table can come later if needed.
- Colouring by status instead of type. Rejected: type colour is still useful
  for scanning upcoming work; the sent/skipped states override it only once the
  occasion leaves the "upcoming" bucket, which is exactly when type matters less.

## Consequences

- The calendar now answers "has this gone out?" at a glance.
- The occasion payload is slightly larger (one nested object, `null` for the
  common not-yet-ordered case) and does one extra indexed join per list — a
  month view is a single `findMany`, so the cost is negligible.
- `order` is optional in the shared `occasionSchema`, so endpoints that don't
  select it (create/approve/skip/prepare/update) still parse unchanged.
