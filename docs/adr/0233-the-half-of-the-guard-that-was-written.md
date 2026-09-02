# 0233 — The half of the guard that was written

## Status

Accepted — implemented. From the follow-up review's #32 and #30. Completes the
import-counting work and closes out ADR 0210's open item.

## Context

**#32 — the duplicate guard covered one branch of two.** The CSV import walks
its rows and sorts each into one of two piles: a row matching a contact already
on file goes to `toUpdate`, anything else becomes a candidate new contact.
Duplicate rows within one file were handled — for the second pile:

```ts
const pending = hasDistinguishingInfo ? pendingByKey.get(key) : undefined;
if (pending) {
  pending.recipient.email = parsed.email ?? pending.recipient.email;
  summary.warnings.push({ row: rowNumber, message: `Duplicate of row ${pending.rowNumber} …` });
  continue;
}
```

The first pile had nothing. Two rows naming the same **existing** contact both
incremented `summary.updated` and both pushed the same id into `toUpdate`: two
redundant writes for one person, no duplicate warning, and a report reading
_"updated 2"_ for a single contact.

A corrected re-upload is precisely where duplicate rows and existing matches
coincide — it is the most common real import, and the branch without the guard
is the one it takes.

**#30 — the segments overview's total work is still unbounded.** ADR 0210
bounded the _concurrency_ (`mapWithConcurrency(jobs, 6, …)` in one pass, with a
load test asserting peak in-flight and pinning the constant at ≤ 12). It left
the total unbounded and said so. `savedRows` has no `take`, and there is no
per-account cap: five hundred saved lists would be a thousand queries in
eighty-odd sequential waves, holding six pool connections throughout, on every
page load.

## Decision

**The import's existing-match branch gets the same guard as the create branch**,
via a map from existing contact id to the update already queued for it. A second
row naming that contact merges into the first, the later value winning, and is
reported as the duplicate it is — the same sentence, against the same row
number, as the new-contact case. One contact, one increment, one write.

**The segments cap is not added, and that is a decision rather than an
omission.** A `take` on `savedRows` would be wrong: the page needs every saved
list — it filters them client-side, counts them, and diffs them against the
suggestions — so a bound would silently show fewer lists than the account has,
trading a correctness bug for a performance one. And a per-account cap is a
product decision, taken and deferred on measured evidence: across every account
on the platform, the maximum number of saved lists is **one**.

What was missing is not the cap but the watch on the assumption it rests on. So
the overview now warns when an account passes fifty saved lists:

```ts
if (savedRows.length >= SAVED_SEGMENT_WARN_THRESHOLD) {
  this.logger.warn(`Account ${accountId} has ${savedRows.length} saved smart lists — …`);
}
```

The page still works at fifty; the point is that somebody is told while it is
still a deferral, rather than discovering it as a slow page nobody can explain.

## Consequences

- An import reports one update per contact, however many rows name it, and names
  the duplicate row.
- Two mutations caught: removing the existing-branch guard, and letting the
  earlier row's value win instead of the later one (which would contradict how
  the new-contact case merges).
- The deferred cap now has a tripwire rather than a hope.

## What "fixed" meant the first time

#32's original fix was real: `created` stopped counting rows the database had
refused, and a test raced a colliding contact through middleware to prove it.
The duplicate warning was added in the same change. Both landed on the create
branch, because that is the branch the finding named.

Reading a fix as done because its finding is closed is how the other half stays
open. This is the sixth time in this round — after ADRs 0221, 0224, 0226, 0227
and 0228 — that the work was to take a fix already made and ask which _other_
call site, branch, or application has the same shape. It has been the highest-
yield question available in every wave.
