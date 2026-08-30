# 0194 — Write the exclusion, not the list

## Status

Accepted — implemented. From an external code review (finding 26 of 37).

## Context

`retirePastOccasions` closes off dates that have been and gone with no card
sent. Its docstring names three cases, the third being:

> **A hand-added event.** Only birthdays, renewals and anniversaries are
> promoted on a timer, so a graduation or a leaver's date sat "Scheduled" for
> ever with a live "Prepare card" button beside it.

The query beneath it retired `source: "one_off_campaign"` only. `EventsService`
creates every member occasion with `source: "shared_event"`, and
`promoteDueOccasions` moves only birthday/renewal/anniversary _types_ — so a
shared event typed `achievement` was reached by neither.

Forty members on a "Results Day" dated 20 August, nobody orders. A year later
all forty still read "Scheduled" on the calendar, each with a "Prepare card"
button that throws `ConflictException("That date has already passed…")` — the
exact round trip retiring was introduced to stop (ADR 0174). The docstring
described the situation while the query excluded it.

This is the eighth instance in this review of a comment stating the correct rule
next to code doing something else, and the mechanism here is worth naming: the
filter was a **list of things to sweep**. `shared_event` was added to the schema
later, and nothing made anyone revisit the list. A list of what to include fails
silently when the world grows; the omission looks exactly like the code being
finished.

## Decision

The filter is expressed as an exclusion of the sources that do not need
sweeping, named in `@kudos/shared-types`:

```ts
export const ROLLING_OCCASION_SOURCES = ["recurring_per_recipient"] as const;
```

```ts
source: {
  notIn: [...ROLLING_OCCASION_SOURCES];
}
```

`recurring_per_recipient` occasions are regenerated each year from a dated
anchor — a date of birth or a `RecipientKeyDate` — so a past-dated one is a
transient state between the date passing and the next nightly run rather than a
dead row. Everything else is created once, for a date that will not come round
again, and its date passing is terminal.

Today the two forms select identical rows. The difference is what happens to the
_next_ source someone adds: under an inclusion list it is silently never
retired, which is the bug being fixed; under the exclusion it is swept unless
someone deliberately exempts it. The failure modes are not symmetric — a row
wrongly left live is invisible for a year, a row wrongly retired shows up as
"missed" and gets reported.

The set is named rather than written as a bare `not`, following
`ABANDONED_OCCASION_STATUSES`, whose docstring makes the same argument about
unnamed exclusions silently widening.

## Consequences

- Shared-event cohorts nobody ordered for are retired as `missed` on the next
  nightly run, and the calendar stops offering a button that only throws.
- No backfill is needed. The sweep is platform-wide and unscoped, so every
  historical shared-event occasion is picked up the first night after deploy.
  Accounts with old cohorts will see a batch of them move to "missed" at once —
  correct, and worth expecting.
- `missed`, not `skipped`: nobody chose this. See ADR 0178.

## Two rules that were load-bearing and untested

Mutation testing found the new exclusion had no guard on either side of it.
Reverting the filter to `one_off_campaign` was caught by the new test, but
**deleting the source filter altogether was not**, and neither was loosening the
date bound from `lt` to `lte`. Both are deliberate, documented decisions with
real consequences:

- Sweeping `scheduled` recurring occasions would write "missed" onto a birthday
  the scheduler is about to roll forward.
- `lte` would retire an approval dated _today_. It is too late for the card to
  arrive on the day, but whether to send it late belongs to the customer;
  retiring it takes the choice away without asking.

Both now have a test. They are pre-existing gaps rather than anything this
change introduced, but they guard the behaviour this change depends on, so they
belong here.
