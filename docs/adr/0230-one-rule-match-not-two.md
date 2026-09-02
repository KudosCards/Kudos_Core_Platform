# 0230 — One rule match, not two

## Status

Accepted — implemented. From the follow-up review's #24/N6. Completes ADR 0195.

## Context

ADR 0195 fixed a seasonal rule that was being applied backwards, and stated the
principle it was fixing to: the nudge and the extra lead must agree, because _"a
nudge saying the post is slow beside a schedule computed as though it isn't
would be the platform contradicting itself."_

Both functions were then changed to match on the posting date rather than the
occasion date — but they compute _different_ posting dates:

```ts
// computeDispatchDate: the rule is chosen from the BASE date, before extra lead.
const base = workingDaysBefore(occasionDate, leadDays, holidays);
const rule = seasonalDispatchRuleFor(base, options.seasonalRules);
if (!rule?.extraLeadDays) return base;
return workingDaysBefore(occasionDate, leadDays + rule.extraLeadDays, holidays);

// suggestFirstClass: the rule is chosen from the FINAL date, after extra lead.
const posting = computeDispatchDate(occasionDate, DEFAULT_POSTAGE_LEAD_DAYS, { ... });
const rule = seasonalDispatchRuleFor(posting, options.seasonalRules);
```

Where the extra lead carries the final date back _out_ of the window that
granted it, the two disagree. The card is scheduled three days early for the
Christmas rush, and the Approvals screen, the batch composer and the calendar
show no First-Class nudge on it — the exact contradiction ADR 0195 removed,
reintroduced by the fix for it.

Measured rather than reasoned about, across the 2025–2028 horizon on the default
rules: **16 occasion dates**, all in a band a few days wide at the start of
December. Every one is the same direction — schedule takes the lead, nudge goes
missing. The nearest still ahead is **2026-12-08**.

| Occasion   | Posts      | Would post without the rule | Nudged? |
| ---------- | ---------- | --------------------------- | ------- |
| 2026-12-08 | 2026-11-26 | 2026-12-01                  | no      |
| 2026-12-09 | 2026-11-27 | 2026-12-02                  | no      |
| 2026-12-10 | 2026-11-30 | 2026-12-03                  | no      |

## Decision

The two answers come from one match:

```ts
export function dispatchPlan(occasionDate, leadDays, options): DispatchPlan {
  const base = workingDaysBefore(occasionDate, leadDays, holidays);
  const rule = seasonalDispatchRuleFor(base, options.seasonalRules);
  if (!rule?.extraLeadDays) return { dispatchDate: base, rule };
  return {
    dispatchDate: workingDaysBefore(occasionDate, leadDays + rule.extraLeadDays, holidays),
    rule,
  };
}
```

`computeDispatchDate` returns its `dispatchDate`; `suggestFirstClass` reads its
`rule`. Neither derives the other's answer any more, so the agreement is not a
property that has to hold — it is the same value, read twice.

The base date is the right one to match on, and that is not arbitrary. The
question a seasonal rule answers is _"is this card going into the Christmas
post?"_ The base date is when it would ordinarily go; the extra lead is the
adjustment made _because_ of the answer. Matching on the adjusted date asks the
answer's own answer, which is how a card ends up excused from a rush it was
given three days for.

## Consequences

- The schedule and the nudge cannot disagree, on any date, for any rule set —
  including admin-configured ones, which is the case a fixed list of examples
  would never cover.
- No migration. Existing occasions keep their stored `dispatchDate`, which was
  already correct; only the nudge changes, and it is computed at render time.
- Two mutations, each caught: re-deriving the rule from the final date in either
  function.

## The test that asserted the property and could not see it fail

ADR 0195's own test is named _"follows the same posting-date rule as the lead
calculation"_ — it names the invariant exactly. It checks two dates: 4 Jan and
1 Dec. Neither is in the divergent band, and the band is only a few days wide,
so the property could break in full while its test stayed green.

The replacement checks every date from 2025 to 2030 and reports the failures as
a list, so a future divergence names its own dates rather than saying "expected
true, got false". Where an invariant is cheap to check exhaustively, examples
are a worse test — they document the intent and then sample the space at
precisely the points a person thought of, which are the points least likely to
be wrong.

## Where the review had it

Filed as #24/N6, correctly, including the count of 16 and the observation that
the existing test's two dates both miss the band. Its "nearest is 2026-12-09" is
one day out — 2026-12-08 diverges too — which changes nothing about the finding.
