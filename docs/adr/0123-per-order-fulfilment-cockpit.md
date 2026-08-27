# 0123 — Per-order fulfilment cockpit on /admin/orders/[id]

## Status

Accepted

## Context

Kudos HQ had two disconnected fulfilment surfaces. The cross-account **dispatch
queue** (`/fulfillment`, ADR 0010/0108) is the batch workspace — great for
printing a run and posting many cards across accounts at once. The **order detail
page** (`/admin/orders/[id]`, ADR 0109) showed a single order's cards but was
**read-only**: an operator who wanted to drive one order end to end had to read
its state here, then hop to the queue, filter, and act. There was no place to work
a single order as a unit.

## Decision

Turn the order detail page's card list into an interactive **cockpit**, reusing
the existing PlatformAdmin-gated fulfilment endpoints — no new endpoints, no new
state machine.

### 1. Per-card actions, mirroring the queue

Each card row now carries the same verbs as the queue:

- **View / print** — opens the shared `PrintRunOverlay` (personalised faces →
  browser print/Save-as-PDF) via `POST /fulfillment/print-run` for that card.
- **Dispatch (Royal Mail)** — `POST /fulfillment/jobs/:id/dispatch`, shown only
  when shipping automation is on and the card is `printed`.
- **Next step** — `POST /fulfillment/jobs/:id/transition` (Mark printed →
  posted → delivered), the same forward-only step map the queue uses.
- **Retry Click & Drop** — `POST /fulfillment/jobs/:id/click-and-drop`, shown on
  an import error when C&D is enabled.

Plus, from ADR 0122, the row shows the **status trail** (printed → posted →
delivered with dates), a **Track** link, and a **Print label** link.

### 2. Order-level batch actions

A header bar drives the whole order at once, each button appearing only when it
has cards to act on:

- **Print sheet (N)** — every card in one overlay.
- **Dispatch all (N)** — bulk `POST /fulfillment/jobs/dispatch` over the printed
  cards (shipping on).
- **Mark all posted (N)** / **Mark all delivered (N)** — `POST
/fulfillment/jobs/bulk-transition`.
- **Check deliveries** — `POST /fulfillment/poll-deliveries` (ADR 0121), to pull
  tracking now instead of waiting for the hourly sweep.

### 3. Consistency by refetch, not hand-patching

After every action the client calls `router.refresh()`, re-running the server
component so the header progress bar and the card rows update together from one
source. The cockpit holds only transient UI state (which action is busy, the
overlay, errors); the order data always comes from the server. This avoids the
drift a manual optimistic patch of both progress and rows would risk.

### 4. API: milestone timestamps on the line

`AdminOrderLine` (shared-types + `admin.getOrder`) gained `printedAt`, `postedAt`,
`deliveredAt`, and `labelUrl`, so the trail and label link render straight from
the order payload with no extra fetch. Still **no street address** on the line —
the cockpit's data minimisation (ADR 0109/0057) is unchanged; the full address
stays behind the audited fulfilment export.

## Consequences

- An operator can take a single order from paid → printed → posted → delivered
  from one screen, or fall back to the cross-account queue for batch runs across
  orders. The queue is unchanged and remains the batch workspace.
- Zero new endpoints and no new authorization surface — the cockpit is a client
  over endpoints that were already PlatformAdmin-gated.
- The page is now a thin server shell (header, progress, payment) hosting a
  client cockpit for the cards; the previously-static table moved into it.
- Covered by the existing admin order-detail e2e (extended to assert the new
  milestone fields are present and null while pending) plus the web build; the
  action wiring reuses endpoints already covered by the fulfilment/dispatch/
  delivery-poll e2es.

## Alternatives considered

- **Keep the page read-only and send operators to the queue with a pre-applied
  filter.** Rejected: it never lets you see and act on one order as a unit, which
  was the whole gap; the queue can't scope to a single order cleanly.
- **A dedicated per-order fulfilment endpoint returning richer state + actions.**
  Rejected as premature: the existing job endpoints already do everything the
  cockpit needs; adding the four `*At`/label fields to the order line was enough.
- **Optimistically patch rows + progress client-side after each action.**
  Rejected: keeping the progress roll-up and the rows in sync by hand is
  error-prone; a `router.refresh()` is simpler and always correct.
