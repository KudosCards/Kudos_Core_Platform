# 0109 — Ops order-detail view & real fulfilment progress

## Status

Accepted

## Context

Second slice of the `/admin` operations rework (after ADR 0108's dispatch-date
queue). The ops orders list (`/admin/orders`) had three problems that made an
order impossible to work as a unit:

1. **The "Fulfillment" column was fake.** It rendered `fulfillmentLabel(order.status)`
   — a word derived from the _order_ lifecycle status ("Pending" / "In progress"
   / "Delivered"), not real card progress. An operator could not see "340 of
   2,000 posted".
2. **The list silently capped at 100.** The page fetched `?perPage=100` once and
   the client filtered and searched **in memory** over those rows. `listOrders`
   already supported server-side `status`/`search`/pagination — it just wasn't
   wired — so on a busy week search and the status filter quietly missed
   everything past the newest 100 orders, and there were no pagination controls.
3. **There was no way into an order.** No `/admin/orders/[id]`; rows weren't
   clickable. A 2,000-card order was only ever visible as one summary row.

## Decision

### 1. Real fulfilment progress, computed from the jobs

A shared `OrderFulfillmentProgress` — per-status counts of an order's
`FulfillmentJob`s plus the Click & Drop import/error tally — is attached to every
order row and to the detail view.

- **On the list**, progress for just the current page's orders is fetched in
  **one** aggregate. `FulfillmentJob`'s order lives one hop away (via
  `OrderRecipient`), which Prisma's `groupBy` can't group across, so this is a
  single filtered aggregate over the join scoped to the page's order ids — not a
  per-row query. Orders with no jobs yet (unpaid) default to all-zeros.
- **On the detail**, progress is reduced from the card lines already fetched — no
  extra round-trip.
- `total` is the number of fulfilment jobs, which is 0 before payment (jobs are
  created at settlement); the UI shows "not in fulfilment yet" rather than 0/0.

### 2. `GET /admin/orders/:id` — one order worked as a unit

`getOrder(id)` returns the header (with the VAT-inclusive money breakdown and
receipt link), the progress, and every card line: recipient name, design,
occasion, postage, due date, job status, tracking, and Click & Drop state.

**Data minimisation, same rule as the queue.** A line carries name + occasion +
postage + status — **never the street address**. The full address stays behind
the audited fulfilment export (ADR 0010 / the queue's `QUEUE_SELECT`). Because
the detail exposes only what the cross-account queue list already does (names,
no addresses), it isn't separately audited — consistent with the queue list,
which is also unaudited, while the address export and single-card address view
remain audited.

### 3. Wire the list to the server; make rows a way in

The orders page now reads `status` / `search` / `page` from the URL and passes
them straight to `listOrders`, deleting the in-memory filter. The client drives
those params (debounced search, status select, prev/next pagination) via the URL,
so the list is server-resolved and no longer capped. Rows link to
`/admin/orders/[id]`; the detail deep-links back to the dispatch queue for the
cards still open, and to the account's Customer 360.

## Consequences

- An operator can open an order and see 340/2,000 by status, the Click & Drop
  import health, and every card's deadline and tracking — and can find any order
  by number or account regardless of how many orders exist.
- The progress shape is shared (`@kudos/shared-types`) across the list row and
  the detail, so the "posted" readout means the same thing everywhere.
- No schema change — this is read-side aggregation over existing tables, building
  directly on ADR 0108's denormalised `dueDate` (which the detail's per-line due
  column reads).
- **Follow-up:** the subscribers/customers list has the same in-memory-cap
  pattern (`?perPage=100` + client filter). It's out of scope here and should get
  the same server-wiring treatment.

## Alternatives considered

- **Denormalise a progress counter onto `BatchOrder`.** Rejected: it would have
  to be kept in sync on every fulfilment transition (a write amplification and a
  drift risk) to serve a read that a scoped aggregate answers cheaply.
- **Per-row progress queries on the list.** Rejected: N queries per page. The
  single page-scoped filtered aggregate is one round-trip.
- **Show street addresses on the detail for convenience.** Rejected: it would put
  every recipient's home address on a cross-account screen, breaking the data
  minimisation the queue deliberately enforces. The audited export is the path to
  addresses.
