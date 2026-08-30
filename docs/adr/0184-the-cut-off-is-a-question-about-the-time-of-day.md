# 0184 — The cut-off is a question about the time of day

## Status

Accepted — implemented. From an external code review of the dispatch paths
(finding 7 of 37).

## Context

ADR 0160 added a same-day cut-off: a card ordered on a working day before 15:00
UK catches that day's Royal Mail collection; ordered at or after it, or on a
weekend or bank holiday, it posts the next working day. The engine expresses it
in one line:

```ts
const missedToday = hour >= cutoffHour || !isWorkingDay(today, holidays);
```

`resolveSendSchedule` had `today` in scope and passed it to `deliverByWindow`:

```ts
const today = startOfUtcDay(new Date());
…
const { earliest, latest } = deliverByWindow(postageClass, today);
```

`deliverByWindow` hands that value to `sendNowDispatchDate`, which reads
`londonParts(now).hour` from it. A value that has had its time truncated away
has an hour of 0 — so `hour >= cutoffHour` was **always false**. Half of that
disjunction was dead code.

The second half still worked, which is exactly why nobody noticed: weekends and
bank holidays were handled correctly, so the cut-off appeared to function. Only
the hour was dead, and only on weekday afternoons.

Measured, first class, Tuesday 15 September 2026 (London on BST, so 15:00 UTC is
16:00 local):

| Ordered   | Actually posts | API's earliest arrive-by | Web picker's earliest | Post-by for the API's own earliest |
| --------- | -------------- | ------------------------ | --------------------- | ---------------------------------- |
| 09:00     | Tue 15 Sep     | Tue 22 Sep               | Tue 22 Sep            | 15 Sep — fine                      |
| **16:00** | **Wed 16 Sep** | **Tue 22 Sep**           | **Wed 23 Sep**        | **15 Sep — already gone**          |
| **20:00** | **Wed 16 Sep** | **Tue 22 Sep**           | **Wed 23 Sep**        | **15 Sep — already gone**          |
| Sat 11:00 | Mon 21 Sep     | Mon 28 Sep               | Mon 28 Sep            | 21 Sep — fine                      |

Two consequences, both live every weekday afternoon:

1. **The API and the web disagreed by a working day.** The web calls
   `deliverByWindow(postageClass)` with no `from`, so it defaults to the real
   clock and was right all along. The API passed midnight and was a working day
   too permissive.
2. **Orders were accepted with a post-by date whose collection had gone.** The
   second guard compared `dispatchDate < today` — also midnight — so a card
   whose post-by date was _today_ passed at 16:00, and landed in the ops queue
   as due today for a van that had already left.

The "Send now" branch of the same method called `sendNowDispatchDate()` with no
argument and was correct throughout. One method, two paths, one clock between
them — and only the path that reused a convenient variable was wrong.

## Decision

Pass the instant, and compare against the day a card can actually leave.

```ts
const { earliest, latest } = deliverByWindow(postageClass, now);
…
const soonestPostingDay = sendNowDispatchDate(now);
if (dispatchDate.getTime() < soonestPostingDay.getTime()) { … }
```

Both halves are load-bearing and are pinned by different tests: reverting the
window to `today` makes the rejection message name a date the picker does not
offer; reverting the guard to `today` accepts the impossible date outright.

### `now` is a parameter, not a call

`resolveSendSchedule` moves out of the service into `send-schedule.util.ts` and
takes `now` explicitly. The cut-off is a question about the time of day; a
function that answers it by reading a global clock cannot be tested at 16:00
without freezing time around a Nest application and a database. With the clock
as an argument the whole rule is nine plain assertions and no mocking at all —
which is the reason this went unnoticed for as long as it did, since every
existing `deliverByWindow` test passes a UTC-midnight `from` and so exercises
only the half of the guard that worked.

## Consequences

- The API and the web date picker now agree on every hour of every day.
- A page loaded at 14:55 and submitted at 15:05 carries a pre-cut-off earliest.
  That is now refused with a message naming the date the picker would offer, in
  place of being accepted and quietly missing the post.
- Two mutations, each caught by a different test.
- **Not addressed here.** `deliverByWindow(postageClass, from)` still takes one
  `Date` and uses it for two different purposes — a calendar day for `latest`,
  an instant for the cut-off — so the same trap is available to the next caller.
  Splitting that signature is a change to a shared package used by both apps and
  wants doing on its own.
