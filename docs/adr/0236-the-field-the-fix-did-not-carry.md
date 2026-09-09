# 0236 — The field the fix did not carry, and the warning nothing was listening to

## Status

Accepted — implemented. Found by re-reading the thirteen PRs merged since the
last audit (#410–#422) against the error classes the review itself identified,
rather than against new findings. The same exercise as ADR 0215, one batch on.

## Context

ADR 0215 audited the weekend's 27 PRs against seven classes. This audit ran the
same seven over #410–#422 — 58 files, 3,816 added lines — plus the class this
run of work kept producing and named in six of its own records:

> the fix was applied where the finding pointed, and the identical defect
> survived one call site, one branch, or one field over.

Most classes came back clean. No new unbounded fan-out; every new Prisma read
either names the account or is a cron sweep with none in scope; no new
local-time arithmetic on a UTC value and no new UTC day key on a London job;
no outbound call outside `httpRequest`; the three CRM contact pulls all take
the wall-clock budget ADR 0231 introduced, not just the one the finding named.

Two did not come back clean, and both are that same class.

## Finding 1 — the delete reported its status and dropped its identifier

`releaseRecipientsAndOccasions` is the release half of a refund. It reads the
order's fulfilment jobs, deletes everything short of `posted`, and returns two
things: `raced`, the cards that were in production when the money came back,
and `clickAndDropOrderIds`, the Royal Mail orders to recall.

ADR 0223 fixed `raced`. The report had been built from a snapshot taken a
round-trip before the delete, so at Read Committed a card that read `pending`
and reached `printed` before the delete was deleted with its stale status still
saying `pending`, and fell out of the report. The fix moved the delete to
`DELETE … RETURNING id, status`, so the status is the one the row actually held
when it went.

`clickAndDropOrderIds` was left on the snapshot:

```ts
clickAndDropOrderIds: jobs
  .filter((job) => !survivorIds.has(job.id) && job.clickAndDropOrderId !== null)
  .map((job) => job.clickAndDropOrderId as string),
```

Same statement, same window, same staleness — one field over.

It is the worse of the two, because of _how_ the identifier is written. The
import sweep runs every five minutes and writes only `clickAndDropOrderId`; it
leaves `status` at `pending`, because the card is still waiting to be printed.
So the likeliest shape of this race leaves nothing else to notice it:

- the job reads `pending`, identifier `null`;
- the sweep hands the card to Royal Mail and stores the identifier;
- the delete removes the row — so it is not a survivor;
- the snapshot still says the identifier is `null`, so it never reaches
  `cancelImported`, and `failed` is empty because the recall was never
  attempted;
- `raced` is rightly empty, because the status never moved.

Nothing escalates. The audit row records `clickAndDropStillLive: []`. The
customer is refunded and Royal Mail posts the card. That is exactly the failure
ADR 0180 exists to prevent, and it happens in silence — which is the one thing
ADR 0223 set out to make impossible.

**Fixed**: the identifier comes back with the delete, and
`clickAndDropOrderIds` is built from what the delete saw. The pre-delete read
and the `survivorIds` set it fed are gone — there is nothing left that wants
them, and leaving a stale snapshot in scope is leaving the trap set.

Held by a new case in `refund-tells-the-truth.e2e-spec.ts`, which races an
identifier in with the status left alone, and asserts the identifier reaches
Click & Drop.

That test also moved the seam the three existing race tests use. They injected
the race on the first `FulfillmentJob.findMany`, which was the snapshot read —
the statement this fix deletes. They now hook the release's own first read
(`OrderRecipient.findMany`), which is the statement the window genuinely opens
after, and does not depend on a read the code has no other reason to make.

Mutations, both caught: returning `NULL` for the identifier, and dropping the
survivors from `raced`.

## Finding 2 — React said so on every render, and nothing was listening

The CRM sync summary gained a list of per-contact refusals in #421 (ADR 0227).
It was rendered inside the summary's `<p>`:

```tsx
<p className={clean ? … : …}>
  {counts}
  {result.errors.length > 0 ? <SyncRefusals errors={result.errors} /> : null}
</p>
```

`SyncRefusals` renders a `<ul>`. A `<ul>` inside a `<p>` is invalid HTML: the
parser closes the paragraph when it meets the list, so in server-rendered
markup the list — and everything after it — falls out of the coloured box it
was written into.

React validates this at render and reports it through `console.error`. It did.
Nine tests covering that component passed, `pnpm test` was green, and CI was
green, because nothing in this repo fails on a `console.error`.

**Fixed**: the summary is a `<div>`, and the refusal block no longer needs the
`<span>` wrapper it wore only to stay legal inside a paragraph.

**And the reason it shipped is fixed too.** `jest.setup.ts` now records React's
nesting complaints and fails the test that produced one. Invalid nesting is the
one class of markup mistake with an exact, machine-checked definition, so the
guard costs nothing to hold — and the whole suite passes with it on, which is
what makes it honest rather than a rule with an exemption list.

Two details, both deliberate:

- The violation is recorded and asserted in `afterEach`, not thrown from inside
  `console.error`. React calls `console.error` from within its own commit
  phase; throwing there fails the render instead of the assertion, and points
  the stack at React.
- React passes the element names as printf arguments, so the recorded text has
  the substitutions applied. Without that the failure reads
  `<%s> cannot contain a nested %s` and names neither element.

Mutation: putting the `<p>` back turns the suite red, naming both the elements
and the test.

## Consequences

- A refunded order's Royal Mail recall now uses what the release itself
  observed. There is no longer a pre-delete snapshot in that function for a
  later change to read from by mistake.
- Every web component test now fails on invalid HTML nesting. Existing suite:
  155 tests, zero violations, so the guard starts clean.
- The three existing refund race tests hook a statement the production code
  needs, not one it merely happened to make.

## What the audit did not find

A clean result is only worth recording if the search was real, so: no new
unbounded `Promise.all` or unpaged `findMany`; no status set duplicated outside
`shared-types`; no new local-time getter on a UTC date and no new
`toISOString()` day key on a London-scheduled job; no new outbound call outside
`httpRequest`; no new account-scoped read that drops `accountId`; and the
wall-clock budget added for one CRM pull is on all three.

One thing was found and deliberately not changed. `airtable-catalog-source.ts`
bounds its pull at 100 pages but takes no wall-clock budget, so it is the
"bounding the parts, not the whole" shape ADR 0231 named. It is a nightly cron
with no user waiting on it, which is the entire reason ADR 0231's finding
mattered, so the fix would be ceremony. Recorded here rather than fixed, so the
next audit finds a decision instead of a gap.
