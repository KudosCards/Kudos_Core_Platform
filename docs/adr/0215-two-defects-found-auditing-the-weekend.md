# 0215 — Two defects found auditing the weekend's PRs

## Status

Accepted — implemented. Found by re-reading the 27 PRs merged over the weekend
(#382–#408) against the error classes the external review identified, rather
than against new findings.

## Context

The review's 37 findings were not 37 unrelated bugs. They clustered:

- a status set duplicated somewhere and drifted (#14, #22, #24, #26)
- a read-then-write outside a transaction (#15, #16)
- unbounded fan-out, memory or query count (#27, #28, #30)
- a screen stating something untrue (#5, #17, #19, #21, #23)
- a count reported without checking what actually happened (#29, #32)
- local-time arithmetic on a UTC value, or a UTC day for a London job (#33, #34)
- one bad row abandoning the batch (#8, #9)

Twenty-seven PRs of fixes are twenty-seven chances to reintroduce them. The
audit ran each class over the weekend's own diff — 58 production files, 2,212
added lines.

Most classes came back clean. New fan-out is bounded (`mapWithConcurrency`),
new reads are paged or key-scoped, every status set added came from
`shared-types` rather than a literal, and no new code does local-time
arithmetic on a UTC date or keys a London-scheduled job on a UTC day.

Two did not.

## Finding 1 — a tenant-scoped read that wasn't

The occasion-reconcile guard added in #383 scopes its write to the account:

```ts
await tx.occasion.updateMany({
  where: { id: { in: ids }, accountId, status: { in: [...OPEN_OCCASION_STATUSES] } },
  …
});
```

The read directly below it, which works out _which_ occasions were lost so the
error can name them, does not:

```ts
await tx.occasion.findMany({
  where: { id: { in: … }, status: { in: [...OPEN_OCCASION_STATUSES] } },
  select: { id: true },
});
```

Nothing is reachable through it. The ids come from the caller's own recipients,
so they are already this account's. But the review's single unqualified pass was
tenant isolation — "no IDOR found; every account-scoped service consistently
uses `findFirst({ where: { id, accountId } })` or scopes the mutation via
`updateMany`/`deleteMany` with `accountId`" — and that consistency is the whole
defence. It decays one query at a time, and the argument for why _this_ one is
safe is exactly the argument that will be made for the next one.

Every other `id: { in: … }` occasion query in that file names the account.

**Fixed**, and held by `occasion-reads-are-scoped.spec.ts`: a source scan that
walks each `occasion.<read>({…})` call in the file and fails on any whose
argument doesn't mention `accountId`.

The scan found a second, pre-existing one in `settleFulfillment`, which takes
only a transaction and a batch-order id — there is no account in scope to name.
Threading one through the Stripe settlement path is a change worth making
deliberately, not as a side effect of an audit, so it is listed in the guard's
`EXEMPT` with that reason. A further test asserts each exemption still matches a
real query, so an exemption cannot outlive the code it covers and quietly become
a hole.

## Finding 2 — one bad row abandoning the batch, again

ADR 0186 (finding 9) established the rule for the CRM ingest: a single contact
that fails to update is reported and the rest carry on, because the alternative
is a 500 and a half-applied import that repeats nightly.

The CSV import's email pass — rewritten in #399 to run at bounded concurrency —
still had the original shape:

```ts
await mapWithConcurrency(toUpdate, RECIPIENT_UPDATE_CONCURRENCY, async ({ id, email }) => {
  await this.prisma.recipient.update({ where: { id }, data: { email } });
});
```

One rejection rejects the whole map, and by then the creates have committed. The
customer gets an error and an import that half happened.

Narrower than its CRM sibling: `email` is not part of any unique index on
`Recipient`, so the constraint collision that motivated ADR 0186 cannot fire
here. What can is a row deleted between the dedupe lookup and this write. Rare —
and the cost when it happens is the whole import.

The review said of a neighbouring case that "the two paths disagree". They
still did.

**Fixed**: each failure is caught, recorded against its row number, and surfaced
in `summary.warnings` — the field that already exists for "imported, but
something about it didn't take". `toUpdate` now carries the row number so the
warning can name it.

## Consequences

- Six mutations, all caught: removing the scoping again; a scan that matches
  nothing; an exemption for a query that no longer exists; the CSV update
  reverting to unguarded; failures swallowed without a warning; and later rows
  not being updated after an earlier one fails.
- No behaviour changes for anything that was already working. Both fixes only
  affect paths that were failing.
- The scoping guard is per-file rather than repo-wide, because that is what
  could be written honestly today. A repo-wide version is a bigger piece of
  work: many reads are legitimately unscoped (platform-admin paths, webhook
  settlement, cron sweeps), so it needs a real exemption model rather than a
  list of one.

## What the audit did not find

Worth recording, since a clean result is only useful if the search was real:
no new unbounded `Promise.all`, no new unpaged `findMany` beyond the one ADR
0210 documents deliberately, no status literal duplicated outside
`shared-types`, no local-time getters on UTC dates, no new `toISOString()` day
key on a London-scheduled job, and no new outbound call outside `httpRequest`
(that one already has its own guard, from ADR 0209).
