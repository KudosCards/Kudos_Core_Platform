# 0216 — The reminder gets a window, not an instant

## Status

Accepted — implemented. The separate call ADR 0211 flagged and deliberately did
not take.

## Context

The dispatch reminder is the standing weekday digest to Kudos HQ naming the
cards that must be posted to keep every order inside its send-by window
(ADR 0115). It is the notification the posting operation actually runs on.

Its cron fires hourly on weekdays, and the service kept exactly one tick:

```ts
if (londonHour(new Date()) !== config.sendHourLondon) return;
```

Twenty-three ticks discarded, one acted on. If the API is not running when that
single tick lands, the day has no digest at all. Nest's `@Cron` schedules from
process start and does not replay a tick missed while the process was down, so
a deploy spanning 07:00 — build, swap, boot — costs the whole day.

The failure mode is silence. Nobody gets an email that does not arrive, and the
dashboard band and the ops bell are fed by the same run, so there is no second
channel that would notice. The first sign is a card posted late.

ADR 0211 named this while fixing the day key beside it, and left it:

> Relaxing the gate to "at or after the send hour" would fix it, and the
> London-day dedupe now makes that safe — the key would stop a second send. It
> was not done here: "runs only at the configured hour" is a deliberate
> behaviour with a test of its own, and overturning a tested decision belongs in
> a change that is about that decision, not smuggled into a timezone fix.

This is that change.

## How likely is it, honestly

Not very. The vulnerable window is the minutes a deploy spends unavailable
across one particular hour boundary, once a day. Order-of-magnitude, that is a
lost digest something like once a year — not once a month.

It earns a fix anyway, on cost rather than frequency: the harm is a day of
posting deadlines nobody was told about, in a business whose product is a card
arriving on a particular morning, and the fix is one comparison.

## Decision

The gate becomes a window: from the send hour, through to the same-day cut-off.

```ts
private withinSendWindow(hour: number, config: DispatchReminderConfig): boolean {
  const lastHour = Math.max(config.sendHourLondon, config.sameDayCutoffHour);
  return hour >= config.sendHourLondon && hour <= lastHour;
}
```

Three things make this small rather than sprawling.

**The upper bound already existed.** `sameDayCutoffHour` is on the same settings
panel, in the same config object this service already reads: the hour after
which an order placed today no longer posts today. Past it, a digest is asking
for something that can no longer happen, so it is exactly the right place for
the catch-up to stop. No new setting, no new knob to explain.

**The dedupe already existed.** ADR 0211 keyed the notification-centre entry on
the London day, and `runDispatchReminder` returns without emailing when that
entry is already there. A window therefore still costs at most one digest a
day — the second tick and the twentieth both stop at the same guard. The window
is only reachable _because_ 0211 landed first.

**`Math.max` covers a config an operator can actually save.** Both hours are
independently 0-23 on the panel, so a send hour _after_ the cut-off is
permitted. Written as a plain `hour <= config.sameDayCutoffHour`, that config
would satisfy neither bound and the reminder would never run again — turning a
rare missed day into a permanent silence, which is the same bug made worse.
`Math.max` collapses the window to the send hour alone, which is precisely the
behaviour that configuration had before there was a window.

## What this changes beyond the missed tick

Worth stating plainly rather than filing under "no behaviour change", because it
is one.

The digest is suppressed when the board is clear, and that check happens before
the day's entry is written. So on a day that starts with nothing to post, no
entry exists, and a later tick can still send. If a rush order for an imminent
occasion lands at 11:00 on an otherwise-clear day, HQ now hears at 11:00 instead
of 07:00 tomorrow.

That is an improvement — those are cards with a deadline — but it is a change,
and it is why the window needs an upper bound. Without one the same mechanism
would deliver a digest at 23:00 about cards nobody is going to post that night.

Cards do not otherwise drift into the digest mid-day: `mustShip` selects open
jobs due on or before a cutoff computed in whole days, so the set only grows at
a day boundary or when a job is created.

## Consequences

- A deploy across the send hour costs a delayed digest, not a missing one.
- Still at most one digest a day, on the London day, by the ADR 0211 key.
- The operator panel says so: the same-day cut-off field now explains that it
  also closes the digest's window, so an 09:00 digest reads as the system
  catching up rather than as something broken.
- Five mutations, each caught by the tests written for it: reverting to the
  exact-hour match, dropping the upper bound, dropping `Math.max` so the window
  can collapse to nothing, making the cut-off exclusive, and making the send
  hour exclusive.

## What was not done

**A marker recording that the day's scheduled run happened.** It would let the
catch-up distinguish "we were down" from "the board was clear", and so keep the
old suppress-until-tomorrow behaviour for the clear-board case. It needs new
persistence, and the behaviour it would preserve is the worse of the two — a
rush order waiting until tomorrow morning to be mentioned. Rejected on both
counts, not deferred.

**The race in `notifyAllAdmins`.** Its dedupe is a `findFirst` followed by a
`createMany` with no unique constraint behind it, so two API instances ticking
at the same instant can both pass the check and both email. Pre-existing, and
not made worse here: the window's later ticks are stopped by an entry that by
then exists, so the exposure is still the single first tick of the day, exactly
as before. Named here because it is the kind of read-then-write this review
already found twice (ADR 0181, ADR 0184), and it should be closed on its own
terms with a unique index rather than as a side effect of this change.
