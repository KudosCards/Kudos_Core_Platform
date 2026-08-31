# 0210 — One page load should not take the whole pool

## Status

Accepted — implemented. From an external code review (finding 30 of 37).

## Context

The Lists page resolves every suggested preset and every saved smart list on
load, each to a live count plus a small preview. Each resolve is its own
`$transaction([count, findMany])`, so each holds a pool connection for the
duration of two queries. They were all started at once:

```ts
const [suggested, savedRows] = await Promise.all([
  Promise.all(SEGMENT_PRESETS.map(async (preset) => …this.resolve(…))),
  this.prisma.segment.findMany({ where: { accountId } }),
]);
const saved = await Promise.all(savedRows.map(async (row) => …this.resolve(…)));
```

Nothing caps the number of saved segments an account may have — no `take` on the
read, no entitlement check on create, no constraint in the schema.

Measured against an account with 40 saved lists (45 resolves, 91 queries), warm,
three runs at each setting:

| resolve limit | peak concurrent queries | wall-clock |
| ------------- | ----------------------- | ---------- |
| unbounded     | 90                      | ~46ms      |
| 24            | 48                      | ~45ms      |
| 12            | 24                      | ~42ms      |
| 6             | 12                      | ~45ms      |
| 4             | 8                       | ~55ms      |

That is the whole finding in one table. **Wall-clock is flat from 6 upward.**
The parallelism above that bought nothing at all — it just seized more of the
pool to arrive at the same moment. On a pgBouncer transaction-mode pool, a
handful of concurrent page loads at 90 queries each saturates it, and requests
with nothing to do with this page start timing out.

Occasion-mode segments join occasions to recipients, so none of these are cheap
on a real contact book; the flat curve above is on a small local database, which
if anything understates how much a big account's queries would contend.

## Decision

One bounded pass over presets and saved lists together, at
`RESOLVE_CONCURRENCY = 6` — the point where the curve flattens.

Presets and saved lists share the pass rather than running as two bounded
batches, because two bounded batches in flight together have twice the ceiling.
The results come back by index, so the answers land on the lists that asked for
them.

`mapWithConcurrency` (ADR 0207) grew a return value to make this possible:
`Promise<R[]>`, in the order of the input rather than the order things finished.
Its existing callers pass a `Promise<void>` function and are unaffected.

## Consequences

- One page load now asks for at most 6 connections instead of 45, and takes the
  same wall-clock to do it.
- Nothing about the page changes: the same lists, the same counts, the same
  previews, the same order.
- The regression test asserts both the relative bound (peak ≤ limit × 2, the two
  queries a resolve makes) and an absolute one (limit ≤ 12), because an
  assertion written only against the constant would follow that constant
  anywhere.
- A separate test pins that each list keeps its own count, rule and preview. The
  bounded pass reassembles results by index, and an index slip is the failure
  mode that looks fine: every list still shows a plausible number, just the
  wrong one.

## What was not done, and why

**The review also said to paginate `savedRows`.** Not done — it would break the
page in three specific ways, and it does not target the cost.

The row read is a single indexed query over small rows. The cost is the `2 × N`
resolves, not the one read. Paginating the read leaves that untouched while
costing the page:

1. `lists-client.tsx` sorts and filters the full `saved` array client-side, so a
   page of it would filter only what happened to be fetched.
2. The list counter and the "smart" tab count are `saved.length`.
3. The suggestions on offer are the presets _minus_ the rules already saved —
   `savedRules` diffs against the complete set. Given a partial set, the page
   re-offers a list the account has already saved, which its own comment records
   as the bug the page was built to stop doing.

Bounding concurrency addresses what the finding is actually about — one page
load starving everything else — without any of that.

**Total work is still proportional to how many lists an account saves.** An
account with 500 saved lists would issue 1,000 queries at 6 at a time: a slow
page for that account, but no longer a pool outage for everyone else. The clean
bound on total work is a cap on saved smart lists per account, which is a
pricing and product decision rather than an engineering one — flagged, not
taken. `PLAN_CATALOG` has no such limit today.
