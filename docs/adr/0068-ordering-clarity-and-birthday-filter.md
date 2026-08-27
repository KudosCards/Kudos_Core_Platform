# 0068 — Ordering clarity, calendar performance, and a birthday-month filter

## Status

Accepted

## Context

User feedback flagged three friction points on the path to buying a card, all
pulling against the north star of "reduce as much friction as possible for
someone to buy a card":

1. **The calendar flashed on load** — blank → occasions → events — before it
   settled, which read as slow and janky.
2. **Too many ways to "order", none clearly the front door.** The prominent
   header CTA said "Create an order" and dropped the user on the **Checkout**
   screen, which only lists occasions already _approved_ on the calendar. A new
   subscriber with nothing approved hit a dead end ("Nothing is approved and
   ready yet"). Meanwhile the genuinely quick path — pick contacts, pick a
   design, pay — lived under the easy-to-miss "Bulk send" label. The per-order
   card limit (`batchOrderMaxSize`, 20 on every current plan) was also invisible
   until the API rejected the order.
3. **No way to find people by birthday month.** "Everyone with an August
   birthday" is exactly the group a user wants to select and send to, but the
   contacts list could only be searched by name.

## Decision

**Calendar: paint once.** The page now server-fetches occasions **and** shared
events in parallel and seeds both into the client (`initialEvents`), so the
first paint is the final paint. The client skips its first-render refetch for
both (a `firstEventsRender` ref mirrors the existing occasions guard), and
`today`/`todayKey` are memoised so they're stable references rather than rebuilt
each render. See `calendar/page.tsx` and `calendar-client.tsx`.

**Make the quick path the front door.** The prominent header CTA is now
**"Send a card" → `/send`** (desktop "Send a card →", mobile "Send"), the
low-friction pick-contacts-pick-design-pay flow — instead of "Create an order →
Checkout". The sidebar renames "Bulk send" → **"Send a card"** and the page's
own H1 matches. "Create an order" is de-emphasised, not removed: **Checkout**
stays in the sidebar and remains the place approved occasions get paid for; its
intro copy now says so explicitly and points quick sends at `/send`. This was
the owner's steer: the header button they singled out was the one on the main
subscription-dashboard bar.

**Surface the per-order limit.** Checkout now fetches
`/accounts/me/entitlements`, shows a live "N of {max} selected" counter, warns
and disables the pay buttons when the selection exceeds `batchOrderMaxSize`, and
explains the cap in the intro. The server remains authoritative (it already
enforced the cap) — this just stops the user hitting it blind.

**Birthday-month filter on Contacts.** A new `?birthMonth=1..12` query on the
recipients list returns contacts whose date of birth falls in that month,
**ignoring the year**. Postgres has no month-extraction operator exposed through
Prisma's typed `where`, so the service resolves the matching ids with a small
account-scoped `EXTRACT(MONTH FROM date_of_birth)` raw query and constrains the
main (still paginated, still `count`-backed) query by `id IN (...)`. The web
adds a "🎂 All birthdays / January … December" dropdown next to the existing
"Needs address" filter, wired through the same `reload()` the other filters use.

## Consequences

- The calendar no longer flashes; first paint is complete and stable.
- The most common intent — "send a card now" — is the biggest, most obvious
  button, and it lands somewhere that works from a standing start. Checkout is
  still there for the approvals-driven flow, just correctly framed as the second
  half of that flow rather than a competing "create order" entry point.
- Users see the 20-card cap before they build an over-sized order, with a clear
  "start another order for the rest" nudge.
- "Everyone with a birthday this month" is a one-click filter, then select →
  send. `account_id` is a text column, so the raw query compares text-to-text
  (no `::uuid` cast); an out-of-range month is rejected by DTO validation, and a
  month with no birthdays returns an empty page rather than an error.
- Follow-up still open: month-section grouping ("This month / Next month /
  Upcoming") directly on the calendar list view, and promoting the address
  requirement to a hard API DTO (tracked in 0067).
