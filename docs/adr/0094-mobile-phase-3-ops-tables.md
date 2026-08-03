# 0094 — Mobile friendliness, phase 3: ops list tables

## Status

Accepted

## Context

Phases 1–2b covered the member app and public site. Phase 3 is the internal ops
surface — used mostly on desktop, but an operator may check it from a phone.

Reviewing it, the foundation was already sound: the ops shell has a desktop
sidebar plus a mobile top bar with horizontally-scrollable nav pills and a
`min-w-0` main, so the page never overflows; the **fulfillment queue** — the ops
screen most plausibly used on a phone (dispatching cards) — is already
responsive cards (`flex-col … sm:flex-row`); and every admin data table is
wrapped in `overflow-x-auto`, so a wide table scrolls inside its own bordered box
rather than breaking the layout.

That contained scroll is *safe* but poor UX on a phone: a 720–900px table means
sideways-swiping a row and losing the column headers. The four operator **list**
tables are the ones worth improving:

- Orders (`min-w-[720px]`), Customers/subscribers (`min-w-[900px]`, the widest),
  Returned-to-sender (`min-w-[720px]`), Support queue (`min-w-[820px]`).

## Decision

Apply the same table→stacked-cards pattern established for the member recipients
list (ADR 0091): gate each table to `hidden … sm:block` and add a `sm:hidden`
stacked-card list rendering the same data, so phones get scannable cards and
desktop keeps the dense table.

- **Orders** — order number + value on top, account below, then a status pill,
  fulfillment stage, and date.
- **Customers** — the select checkbox (in a ≥44px tap target), account link +
  type, plan + health pill + join date, and a four-up stat grid (contacts /
  orders / cards / spent).
- **Returns** — recipient + business + stage on top, then a two-column
  definition list (event, reason, days since return, free recovery).
- **Support** — the whole card is a link to the ticket; subject (+ unread dot) &
  status pill on top, ref + business beneath, then priority / category / last
  activity / assignee.

Left on contained horizontal scroll (unchanged): the narrower **Operators**
(`520px`, super-admin config), **seasonal-dispatch** setup (`640px`, config
editor), and the **subscriber-detail** nested orders sub-table (`560px`) — these
are config/detail surfaces, not scan-on-mobile lists, so a stacked rewrite would
be churn for little gain.

## Consequences

- An operator on a phone gets scannable cards for the four queues they'd actually
  check on mobile, instead of sideways-swiping a wide table.
- Desktop is unchanged — the tables still render at `sm` and up; only the
  `sm:hidden` card list is new.
- The duplication (table cells + card fields per row) is the same deliberate,
  contained trade-off accepted for the recipients list: two layouts of one row,
  kept adjacent in the file so column changes are visible in both.
- This closes out the planned mobile pass (member, public, and ops). Remaining
  ops tables are intentionally left on contained scroll.
