# 0075 — Cross-month grouping for the calendar list view

## Status

Accepted

## Context

The calendar's **list view** (the mobile-default, and the "what's coming up"
agenda) showed **one month at a time**: it fetched a single month's range and
rendered every day under one header. To see next month's birthdays you had to
click "next" and wait for a re-fetch. That's the opposite of the planning surface
it wants to be — the whole point of the list is to glance at who's coming up and
order ahead.

Phase 3 fixed the calendar's on-mount "flash" (blank → occasions → events) by
**server-seeding** the initial month so the first paint is already populated. Any
change here has to preserve that.

## Decision

**The list view fetches a forward window and groups by month.** A new
`listWindowRange(anchor)` spans `LIST_WINDOW_MONTHS` (3) whole months from the
anchor's month, and `fetchRange("list", …)` now returns it (month/week views are
unchanged). The `ListView` constrains its days to that window and buckets them by
`YYYY-MM`, rendering each month as its own card with a heading from the existing
`relativeMonthLabel` — **"This month" → "Next month" → "March 2027"** — so the
agenda reads continuously across month boundaries. Prev/next rolls the window a
month at a time; the period label shows the span (e.g. "Jul – Sep 2026").

**Server seed widened to the union, so neither view flashes.** `page.tsx` now
seeds from the month grid's start through the **list window's** end — the union
that covers both first-paint possibilities (month grid on desktop, list window on
mobile). Because occasions *and* events are both seeded across that union,
whichever view the client settles on after hydration already has its data, with
no on-mount fetch. The `ListView` filter drops the few trailing days of the
previous month that the month grid's Monday-aligned start pulls in, so they don't
leak into the agenda.

**Window size is a modest constant.** 3 months keeps a single `perPage=100` fetch
comfortably sufficient for a realistic account's occasions, and keeps the seed
payload small. It's a one-line change to widen later if wanted.

## Consequences

- The list view becomes a genuine rolling agenda: a member sees this month, next
  month, and the month after in one scroll, grouped and labelled, and can select
  approved cards across months into a single order — directly serving "see who's
  coming up and order ahead".
- No new flash: the wider server seed means the mobile list is fully populated on
  first paint, preserving the Phase 3 fix.
- The month and week grid views are unchanged — they still fetch and render their
  own tight ranges; only the list view's fetch range and rendering changed.
- Trade-off: an account with **more than 100** occasions inside the 3-month window
  would see the list truncate at the `perPage` cap (same ceiling the single-month
  list already had). If that ever bites, the fix is pagination or a smaller
  window — noted, not built.
