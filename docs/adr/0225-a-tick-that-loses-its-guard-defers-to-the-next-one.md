# 0225 — A tick that loses its guard defers to the next one

## Status

Accepted — implemented. Closes a regression introduced by ADR 0216.

## Context

The dispatch reminder used to be gated on an exact hour: one tick a day, and if
the API happened to be restarting when it landed, the day's digest was lost
outright. ADR 0216 replaced the instant with a window — hourly ticks from the
send hour to the same-day cut-off, nine of them on the default 07:00/15:00
settings — and leaned the whole thing on the notification-centre entry to keep
it to one digest a day:

> Only the first tick inside the window sends anything — `runDispatchReminder`
> keys the notification-centre entry on the London day and stops there if it
> already exists (ADR 0211), so a window costs at most the same one digest an
> instant did.

That is true when the entry can be written. The code that writes it does not
assume so:

```ts
let created = true;
try {
  created = await this.platformNotifications.notifyAllAdmins({ ... entityId: today });
} catch (error) {
  // Losing the dedupe guard is better than losing the alert — fall through
  // and still email this run.
  this.logger.error(`Dispatch reminder in-app notification failed: ${reason}`);
}
if (!created) return base;
```

`created` is initialised `true` and only ever reassigned on success. A throw
therefore leaves it `true`, and the run proceeds to email — deliberately, and
correctly, for the code as it stood when that catch was written. With one tick a
day, a lost guard cost nothing: there was no second tick for it to have
suppressed.

**Against a window it costs one digest per tick.** A failure durable enough to
outlast the morning — a pool exhausted, a table locked behind a migration, a
replica the notification write happens to land on — sends **nine identical
emails**, one an hour, to every operator. The digest's entire value is that it
is read; nine copies of it is how a standing alert becomes something people
filter.

The regression is mine, from #411. The reasoning that made the catch right was
load-bearing on "one tick a day", and I changed that without revisiting it. No
test covered the catch branch at all, so nothing objected.

## Decision

A tick that cannot record itself hands the day to the next tick — and the caller
says whether there is one:

```ts
if (guardLost && options.retryFollows) {
  this.logger.warn("... deferring the digest to the next tick");
  return base;
}
```

```ts
const { first, last } = this.sendWindow(config);
if (hour < first || hour > last) return;
await this.runDispatchReminder(config, { retryFollows: hour < last });
```

Deferring is safe _because_ there is a window. That is the same fact ADR 0216
introduced, used the other way round: a failed tick is no longer the day's only
chance, so it does not have to gamble.

**The last tick of the window still sends, unguarded.** It has no successor, so
for it the original reasoning is intact and silence is the one outcome this
alert must not have. A send hour after the cut-off collapses the window to a
single tick, which is therefore also the last — it sends too.

`retryFollows` defaults to `false`, so a direct run (a test, a future on-demand
trigger) behaves exactly as it always has: its own last chance.

## Consequences

- Transient failure: the digest arrives an hour later than it would have, once.
- Durable failure: exactly one digest, at the cut-off. Late, but the cut-off is
  the last hour at which a digest is asking for something that can still happen,
  which is why the window ends there.
- Worst case is now one duplicate, not nine — a tick whose _read_ of the entry
  throws at the last hour when an earlier tick already emailed. That is the same
  one-duplicate exposure the pre-window code had.
- Four mutations, each caught: removing the defer, making every tick defer,
  defaulting a direct run to defer, and dropping the `Math.max` that keeps a
  degenerate window one tick wide rather than none.

## What this is really about

The comment on the catch was not wrong. It was right about the code it was
written against, and it stopped being right when the shape of the schedule
changed one method away — with nothing in either place to connect them.

A conditional whose correctness rests on a fact about the _caller_ — here, "this
runs once a day" — is a coupling that no type and no test expresses. Making the
fact a parameter is the cheapest way to stop it going stale: `retryFollows` is
now something the scheduler has to state, so the next person to widen the window
has to answer the question rather than inherit an answer.

ADR 0216's own comment has been corrected to say the guarantee holds _as long as
the entry can be written_, rather than flatly.
