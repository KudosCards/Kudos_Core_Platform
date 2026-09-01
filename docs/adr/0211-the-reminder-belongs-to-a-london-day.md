# 0211 — The reminder belongs to a London day

## Status

Accepted — implemented. From an external code review (finding 34 of 37). One
half fixed, one half examined and found not to happen.

## Context

The dispatch reminder writes one notification-centre entry per day and uses that
entry as its "first run wins" guard: `notifyAllAdmins` returns false when a row
with the same `kind` and `entityId` already exists, and the service then returns
without emailing anyone. So `entityId` is not a label — it is the thing that
decides whether Kudos HQ hears about the cards waiting to be posted.

It was the UTC day:

```ts
const isoToday = new Date().toISOString().slice(0, 10);
```

This is a London-scheduled job for a UK business. Its cron is pinned to
`Europe/London` and its send hour is explicitly `sendHourLondon`, because
somebody had already decided the clock mattered (ADR 0160). The day key was the
one part left on the container's clock.

Through BST a London day begins at 23:00 the previous day in UTC, and
`sendHourLondon` accepts `0`. Two consequences:

- For seven months of the year with an early send hour, the entry is filed under
  yesterday's date — visible in the notification centre, and wrong.
- Two runs an hour apart across London midnight are _different days_ to everyone
  in the UK, but share a UTC date. The second looks like a repeat, and the
  digest goes to nobody. A reminder is a thing whose whole job is to arrive; the
  failure mode here is silence.

## Decision

Use `londonDay(new Date())` — the helper that already existed in shared-types
and already had a spec covering exactly this BST boundary. Both the digest and
the super-admin escalation key on it, because the escalation dedupes on its own
`entityId` and is the louder of the two alerts.

## The other half: spring-forward

The review also said the reminder "can skip a day at spring-forward: the cron
gates on `londonHour === sendHourLondon`, and hour 01 doesn't exist that day."

**It doesn't, and here is why.** The cron is `0 * * * 1-5`. The UK moves its
clocks on a Sunday — the last Sunday in March, and the last Sunday in October.
Checked against the eleven transitions from 2026 to 2036: every one falls on a
Sunday, so the missing 01:00 in spring and the doubled 01:00 in autumn both land
on a day this job does not run. Every day the cron does run offers all 24 hours,
exactly once each.

The mechanism the review describes is real; it just cannot reach this job as
scheduled. What makes that true is one character in a cron expression, which is
a thin thing to rest on silently. So `cron-timezone.spec.ts` now holds it: for
any job that fires hourly _and_ then gates on a configured London hour, every
hour an operator can choose must be reachable on every day the job is scheduled
for. Widening `1-5` to include a weekend fails that test — and would, in fact,
cost a 01:00 digest its day in spring and give it two in autumn.

"Fires hourly and gates on a London hour" is the precise condition. A plain
hourly interval — the delivery poll — does not care which hour it is, so a short
or long day costs it nothing; it is excluded by the same rule that already
exempts interval jobs from the timezone pin.

## Consequences

- The reminder is filed under, and deduped by, the day the UK is having.
- No stored data moves. Existing `dispatch_reminder` entries keep whatever key
  they were written with; the first run after deploy may write an entry for the
  London day that duplicates a UTC-keyed one from the same period. That is one
  extra digest at most, once, and only if the send hour is early enough for the
  two to differ.
- The DST guard is mechanical rather than remembered, and it names the reason in
  its own failure message.

## What was noticed and not changed

`scheduledReminder` gates on `londonHour(new Date()) !== config.sendHourLondon`
— an exact-hour match. If the API is restarting when that hour's tick fires (a
deploy at 07:00, with a 07:00 send hour), the tick is missed and there is no
reminder that day. That is the same harm the finding is titled after, by a much
more likely mechanism than a clock change.

Relaxing the gate to "at or after the send hour" would fix it, and the London-day
dedupe now makes that safe — the key would stop a second send. It was not done
here: "runs only at the configured hour" is a deliberate behaviour with a test
of its own, and overturning a tested decision belongs in a change that is about
that decision, not smuggled into a timezone fix. Flagged for a separate call — taken in ADR 0216, which turns the gate into a
window bounded by the same-day cut-off.
