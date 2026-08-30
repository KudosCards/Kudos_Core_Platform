# 0183 — Remind against the deadline, not the date

## Status

Accepted — implemented. From an external code review of the reminder path
(finding 6 of 37).

## Context

The daily 08:00 reminder digest told a customer which cards were coming up. It
selected them like this:

```ts
const windowEnd = new Date(today);
windowEnd.setUTCDate(windowEnd.getUTCDate() + REMINDER_LEAD_DAYS); // 7
…
occasionDate: { gte: today, lte: windowEnd },
```

Seven calendar days, counted back from the **occasion date**.

But the thing a customer has to beat is the **posting deadline**, and that is
five _working_ days before the date (the send-by-5 SLA, ADR 0115), plus any
seasonal extra lead. Working days and calendar days are not a fixed distance
apart. Measured with the real `computeDispatchDate`, first class:

| Occasion       | Must post by   | Reminder sent | Late by    |
| -------------- | -------------- | ------------- | ---------- |
| 2026-09-15 Tue | 2026-09-08 Tue | 2026-09-08    | **0 days** |
| 2026-05-28 Thu | 2026-05-20 Wed | 2026-05-21    | 1 day      |
| 2026-04-10 Fri | 2026-04-01 Wed | 2026-04-03    | 2 days     |
| 2026-12-18 Fri | 2026-12-08 Tue | 2026-12-11    | 3 days     |
| 2026-12-31 Thu | 2026-12-17 Thu | 2026-12-24    | **7 days** |
| 2027-01-04 Mon | 2026-12-23 Wed | 2026-12-28    | 5 days     |

The reminder was **never early**. The best case — an ordinary weekday with no
holiday in the run-up — landed exactly _on_ the deadline, giving the customer
until that afternoon's cut-off and no more. Every other case was late, and the
Christmas rush was late by up to a week: a 31 December birthday's card had to be
in the post on 17 December, and the warning went out on Christmas Eve.

So the feature's whole purpose — reaching someone while they can still act —
failed precisely when it mattered most, and failed silently. The customer's
first sign of trouble was a card that arrived after the day.

## Decision

Window on `dispatchDate`, not `occasionDate`.

```ts
occasionDate: { gte: today },
OR: [
  { dispatchDate: { lte: deadlineHorizon } },
  { dispatchDate: null, occasionDate: { lte: deadlineHorizon } },
],
```

Three deliberate choices in that shape:

**No lower bound on the deadline.** A card whose posting date has already
slipped is the _most_ urgent thing a customer can be told about while the date
itself is still ahead. Bounding this at `today` would silently drop exactly
those — and it is not hypothetical: a birthday three days away already has a
passed deadline under a five-working-day SLA, which is the case the pre-existing
test covers. Restoring the lower bound as a mutation fails that test.

**An upper bound on the occasion date instead.** A date that has already gone
belongs to the retire sweep (ADR 0178), not to a nudge.

**A null-dispatch fallback.** The column is nullable. Nothing creates a null
today, but a dropped dispatch date must not mean "never remind" — those fall
back to the occasion-date window the code used before.

### The digest now names the deadline

A reminder that does not say what you have to beat cannot be acted on
correctly, and the deadline is routinely a week or more before the date itself.
Each row carries `Post by 17 December`, or `Post today — this one is already
late` in the accent colour when the deadline has gone. The body copy no longer
says "coming up in the next week", which stopped being true the moment the
window moved: it explains that the post-by date is what to work to and why it
sits further ahead over bank holidays and Christmas.

`buildDigestParams` keeps `name` and `date` unchanged so an already-built Brevo
template carries on rendering, and adds `postBy` for it to adopt when it can.

## Consequences

- Customers are now reminded while they can still act, including in December,
  which is both the busiest card month and the one the old rule failed hardest.
- Reminders arrive earlier in absolute terms — up to a fortnight before a
  December date rather than a week — which is the intended effect, not a
  side-effect.
- Ordering is by soonest deadline, which is the order the customer needs to act
  in rather than the order the dates fall.
- Three mutations, each caught: adding a lower bound on the deadline (2 tests,
  one of them pre-existing), reverting to the occasion-date window (2 tests),
  and dropping the post-by line (1 test).
- **Not addressed here.** The digest calls every occasion a birthday — subject
  line, heading and the `birthdays` template param — but the query filters on
  status, not type, so a leaver or achievement card is announced as a birthday
  too. Renaming the template param would break the configured Brevo template, so
  this wants doing deliberately rather than folded into a timing fix.
