# 0250 — Credits one at a time, lookups all at once

## Status

Accepted

## Context

The hourly wallet-campaign sweep credited up to four accounts at once
(`CAMPAIGN_SWEEP_CONCURRENCY`). Each credit is a Serializable transaction that

1. sums every ledger entry for the campaign, to check the budget, and then
2. inserts a ledger entry into that same set.

Two of those running at once each read the predicate the other writes. That is a
serialization cycle **by construction**, not bad luck: Postgres cancels one of
them as a pivot every time it happens. `runSerializable` retries five times with
jitter, and on a quiet database the retry wins. On a loaded one a loser can
exhaust all five attempts inside the window the winner is still committing in.

The credit then throws. `sweepOne` catches it — correctly, so one bad account
cannot take the batch down (ADR 0186) — and counted it as `skipped`, the same
counter used for accounts that were deliberately passed over. So an eligible
customer went unpaid, and the only trace was one error log.

It was not theoretical. It reached CI twice, on two unrelated pull requests
(#464 and #467), as `credited: 1` where the test expected `2`, with the Postgres
container log showing one backend losing the race six times in 300 ms on
`INSERT INTO wallet_ledger_entries`. `run-serializable.ts` already describes the
same scenario in its own comment — the jitter it added made the failure rarer
without making it impossible, because the conflict is structural rather than
incidental.

It was also mis-diagnosed once. The first investigation ruled the serialization
path out because the swallow path's log line was absent from CI. That was not
evidence: the test application's logger output never reaches CI at all, so the
absence meant nothing. The Postgres container log, which _is_ captured, had the
answer in it the whole time.

## Decision

**Credits are applied one at a time. Address lookups stay concurrent.**

The concurrency was only ever worth having for the Supabase round trip that
confirms an address — network work that contends with nothing. Applying the
credits in parallel bought nothing: a credit is a short database transaction and
the sweep has an hour. So the batch is worked in **windows** of
`CAMPAIGN_SWEEP_CONCURRENCY`: the window's addresses are looked up together, then
its credits are applied in sequence.

A window rather than two passes over the whole batch, for two reasons. Looking
every address up first would spend 200 Supabase round trips on a campaign that
can afford three more credits. And a window preserves the candidates' `createdAt`
order, so a budget that runs out mid-batch pays the earliest sign-ups rather than
whichever four addresses happened to resolve first.

**`skipped` is split into `skipped` and `failed`.**

- `skipped` — looked at and deliberately not credited: already credited, address
  unconfirmed, outside the window, campaign no longer live. Nothing is owed.
- `failed` — should have been credited and was not, because the credit threw.

One counter meant an operator could not tell "twelve weren't eligible" from
"twelve are owed money we failed to pay". Only the second is worth acting on.

**The hourly log reports failures.** The summary line was guarded on
`credited > 0 || exhausted.length > 0`, so a sweep that failed _every_ credit
logged nothing at all — the one outcome worth noticing was the one that stayed
silent. `failed > 0` now logs a warning with the count.

## Consequences

- A campaign's credits are serial, so a 200-account batch takes as many
  round-trip-free transactions in sequence. At 30–40 signups a week this is not
  a batch size that exists, and the sweep's own budget still bounds the run.
- The conflict is removed at its source rather than made rarer.
  `DEFAULT_MAX_ATTEMPTS` is untouched, so no other Serializable write in the
  codebase is slowed to paper over this one.
- `failed` above zero is now a real signal. It is recoverable — the account
  still has no campaign ledger entry, so the next sweep retries it — but a count
  that stays above zero is a fault, not noise. Alerting on it is deliberately
  **not** included here: a single transient conflict must not page anyone, and
  choosing the threshold is a separate decision.
- The eager credit at signup still runs one credit per request and can still
  lose a race against a concurrent signup or a sweep. That is the case retries
  and jitter are actually for, and the sweep recovers it within the hour, which
  is the design ADR 0186 and the wallet-campaigns plan already describe.

## Alternatives considered

- **Raise `DEFAULT_MAX_ATTEMPTS`.** Slows every Serializable write in the
  application to work around one contended predicate, and only lowers the odds:
  the conflict still happens on every concurrent pair.
- **Lock the campaign row (`SELECT … FOR UPDATE`).** Converts the optimistic
  abort into a pessimistic wait, which works, but adds raw SQL and still
  serialises the credits — the same outcome with more machinery.
- **Denormalise spend onto the campaign row.** Replaces a predicate conflict
  with a row conflict. Cheaper to detect, still a conflict, and it introduces a
  second source of truth for money.
- **Leave it and let the next sweep recover.** What happens today. It delays a
  customer's credit by up to an hour for a reason entirely within our control,
  and the only record is a log line nobody reads.
