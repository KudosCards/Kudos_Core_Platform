# 0122 — Ops tracking visibility on the fulfillment queue

## Status

Accepted

## Context

Once a card is dispatched (ADR 0072) or auto-delivered (ADR 0121), the queue held
the useful facts — the tracking reference and the `printedAt` / `postedAt` /
`deliveredAt` timestamps are already in `QUEUE_SELECT` and returned on every row —
but the ops UI barely showed them. The tracking reference was printed as inert
text (no way to actually track the item), the milestone timestamps weren't shown
at all, and there was no at-a-glance sense of where a card was in its journey.
Operators had no in-app answer to "did this arrive, and when?".

## Decision

Surface what the queue already returns, no API change:

1. **Track link.** The tracking reference on each row is now a link to Royal
   Mail's tracking page via the shared `royalMailTrackingUrl(trackingNumber)`
   helper (the same one the buyer's dispatch email uses — one source of truth for
   the URL). Rendered "Track <reference>", opening in a new tab. The existing
   "Print label" link is unchanged.

2. **Per-card status trail.** A small `StatusTrail` component renders the
   milestones a card has reached, each with its day — "Printed 3 Aug · Posted 4
   Aug · Delivered 5 Aug" — straight from the row's `printedAt` / `postedAt` /
   `deliveredAt` fields. Only reached steps show; nothing renders for a
   still-pending card. Because the trail reads the row's own timestamps, it needs
   no extra request, and each status tab shows the appropriate depth (the
   `posted` tab shows printed+posted; the `delivered` tab shows all three, so the
   delivery date is visible right there).

The web `FulfillmentJob` type gained the three `*At` fields (ISO strings) it was
already being sent but hadn't declared.

## Consequences

- Operators can click straight through to Royal Mail tracking, and see each
  card's delivered date and progress without leaving the queue.
- Zero API/schema change and no new fetch — purely surfacing existing row data,
  so no added load.
- The delivery date shown is the carrier's own (stamped by the delivery poll, ADR
  0121) when auto-registered, or the operator's mark-time when done manually.
- Deeper per-order tracking (a full timeline on `/admin/orders/[id]`) is left to
  the Phase 3 per-order cockpit; this ADR covers the cross-account queue surface.

## Alternatives considered

- **A full vertical timeline widget per row.** Rejected as too heavy for a dense
  cross-account queue; the one-line trail conveys the same facts without bloating
  each row. The richer timeline belongs on the per-order detail page.
- **Fetch an audit-derived event history per card for the trail.** Rejected: the
  `*At` columns already carry the milestone times the trail needs, so reading the
  audit log would be a round-trip for no extra information.
