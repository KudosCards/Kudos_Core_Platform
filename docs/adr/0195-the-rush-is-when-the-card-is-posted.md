# 0195 — The rush is when the card is posted

## Status

Accepted — implemented. From an external code review (finding 24 of 37), which
asked for this one to be re-examined rather than taken as read.

## Context

`SeasonalDispatchRule.extraLeadDays` adds working days of lead during the Royal
Mail Christmas rush. The bundled rule is 1–31 December, +3 days.

`computeDispatchDate` matched the rule against the **occasion date** — and said
so in its own documentation ("Matched on the occasion's month/day", "Extra
working days of lead for occasions dated inside the window"), so this was a
design decision consistently applied, not a slip.

The decision is wrong. Royal Mail being slower is a property of _when the card
travels_, not of the date it is timed to arrive. Matching on the occasion date
applies the rush to cards that mostly ship before it, and withholds it from cards
that ship squarely inside it.

Measured against the real engine rather than argued:

| Occasion   | Rule matched on           | Posts      | Extra lead                                 |
| ---------- | ------------------------- | ---------- | ------------------------------------------ |
| 2026-12-01 | occasion date → Christmas | 2026-11-19 | +3 — a fortnight early, clear of the rush  |
| 2027-01-04 | occasion date → nothing   | 2026-12-23 | none — the busiest posting day of the year |

The second row is the one that costs money: New Year cards were being posted on
23–31 December, through the worst of the backlog, on base lead only.

## Decision

The seasonal rule is matched against the date the card would be **posted**.

`computeDispatchDate` now runs two passes: count back `leadDays` working days to
get the base posting date, ask which rule that date falls in, and if one matches,
recount from the occasion with `leadDays + extraLeadDays`.

Two passes, not iteration to a fixed point. Re-checking the _extended_ date could
oscillate, and the question worth asking is "when would this card ordinarily be
posted", not "when would it be posted given the answer to this question".

`seasonalDispatchRuleFor`'s parameter is renamed from `occasionDate` to `date`,
with a note saying why. The old name is what invited the mistake: it told every
caller exactly which date to pass, and it was the wrong one.

`suggestFirstClass` follows the same rule. It has to: left alone, the platform
would nudge "Royal Mail is slower" for a card posting on 19 November while
scheduling a card posting on 23 December as though the post were running
normally — contradicting itself in both directions. Its wording changes from
"slower now" (a claim about the moment the customer is reading the screen) to a
claim about when the card posts, which is what the rule actually knows.

### The alternative that was rejected

Matching if **either** endpoint falls in the window — the occasion date or the
posting date — is the conservative option: it only ever adds lead, never removes
it, and it covers a card posted just before the rush that travels into it.

It was rejected because it makes the window mean something an administrator
cannot predict. The windows are admin-configurable, and someone setting
"1–31 December" would reasonably be surprised that it moved a card to post on
19 November. "Cards posted in this window get extra lead" is one sentence and is
what the window physically describes; "cards whose occasion or posting date falls
in this window" is neither. The base send-by-5 lead already carries margin for a
card posted shortly before the rush.

## Consequences

Measured over 150 consecutive occasion dates spanning the change (1 Oct 2026
onward), **15 change**:

- **8 gain lead** — occasions 1–8 January, moving from posting 23–31 December to
  18–24 December. This is the fix.
- **7 lose lead** — occasions 1–7 December, moving from posting 19–25 November to
  24–30 November. They keep the full base lead; they were simply being posted
  unnecessarily early.

The send-by-5 SLA (ADR 0115) is untouched either way: the seasonal rule only ever
_adds_ to the base lead, so losing it still leaves five working days. Swept
across two years of occasion dates, the minimum working-day gap between dispatch
and occasion is exactly 5.

### This one needed a backfill — applied 31 August 2026

`docs/ops/p2-17-dispatch-date-backfill.sql` carries the script, the evidence and
the result: 111 occasions moved, matching the sizing forecast on every one of
the 15 affected dates. 62 January occasions came off the 23-31 December peak;
49 December occasions stopped posting earlier than they needed to. It does not
need running again — occasions written after this change use the fixed rule.

Note for anyone reading the sizing query below: it is narrower than the real
exposure turned out to be. It looks only at January and stops at day 8, so it
misses the 1-7 December occasions entirely and truncates the 2028 January range.
The ops script has the full mapping, generated from the engine rather than
written by hand.

### The original note

Unlike most of the fixes in this review, the change is not self-healing.
`dispatchDate` is computed once and stored on the Occasion row, and the nightly
scheduler writes with `skipDuplicates`, so existing rows keep the date they were
given. A contact whose birthday is 4 January may already hold an occasion with
`dispatch_date = 2026-12-23` computed under the old rule, and nothing will move
it.

To size the exposure:

```sql
SELECT id, occasion_date, dispatch_date, status
FROM occasions
WHERE status IN ('scheduled', 'pending_approval', 'approved')
  AND dispatch_date_overridden = false
  AND EXTRACT(MONTH FROM occasion_date) = 1
  AND EXTRACT(DAY FROM occasion_date) <= 8
  AND dispatch_date >= DATE '2026-12-15'
ORDER BY occasion_date;
```

`dispatch_date_overridden = false` matters: a date a human dragged on the
calendar must not be recomputed (ADR 0058).

There is no general "recompute stored dispatch dates" path today — the existing
ops re-date repair is per-order and answers a different question. Building one is
deliberately left out of this change, which is already a behaviour change to a
shared engine; it should be its own piece of work, and it is not urgent until
December.
