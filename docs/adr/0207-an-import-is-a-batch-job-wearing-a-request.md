# 0207 — An import is a batch job wearing a request

## Status

Accepted — implemented. From an external code review (findings 27 and 32,
paired there and here).

## Context

`importCsv` accepts 5 MB — roughly 50,000 rows, per its own comment — and does
three things at a scale nobody sized it for.

**The dedupe lookup** built one `OR` term per eligible row, with no
de-duplication of repeated names and no chunking. **The update fan-out** was
`Promise.all(toUpdate.map(...))`, justified in a comment as "typically a small
fraction of the file, not its full row count". **The birthday backfill** read
every active recipient with a date of birth into memory, on every import.

The comment is the interesting part. The most common real import is not a fresh
file — it is a corrected re-upload of one already imported, where _every_ row
matches. A Centre customer re-uploading their 2,000-contact CSV built a
2,000-term `OR` and then fired 2,000 simultaneous UPDATEs, exhausting the Prisma
pool and stalling every other request on the instance. The work does not finish
sooner for being fired at once; everyone else just waits.

Several comments in this area still assume "any plan's recipientCap (50–200)".
The seeded caps are 50 / 200 / **2,000** / **unlimited**, and have been for a
while.

## The counts were wrong too (finding 32)

`summary.created = toCreate.length` reported what the import _tried_ to insert.
`createMany` runs with `skipDuplicates` for a documented reason — another
request can create a matching contact between the lookup and the insert — and
when that fires, fewer rows land than were accepted. `ingestFromSource` has
always read `result.count`; the CSV path did not, so it could claim a contact
that is not there.

Separately, a second row for the same person _within one file_ was counted as
`updated`. Nothing existing was changed: the row was merged into an earlier one.
Reporting it as an update tells the customer a contact was edited when none was,
and hides that their file contains duplicates. It is now a warning naming the
row it duplicates, which the import report (ADR 0198) already renders per row.

## Decision

- **Dedupe lookup**: distinct (first name, last name) pairs, in batches of 200.
  Bounded by chunking rather than by `take` — a `take` would silently drop
  matches instead of limiting work.
- **Update fan-out**: `mapWithConcurrency`, 8 at a time. The helper existed in
  `catalog-sync.service.ts` and has moved to `common/` so both use one copy.
- **Birthday backfill**: keyset-paginated at 1,000, matching the nightly
  scheduler's equivalent.
- **`created`**: read from `createMany`'s result.
- **In-file duplicates**: a warning, not an `updated`.
- **`AddListMembersDto`**: the 1,000 cap raised to 5,000. It was commented as
  "well above any plan's recipient cap", so a Centre account that ticked all its
  contacts and pressed "Add to list" got a 400 for doing exactly what the button
  offers. 5,000 clears every capped plan; it is a payload bound, and the comment
  now says so.

## Consequences

- A 2,000-contact re-upload no longer monopolises the connection pool.
- The numbers the customer reads are the numbers that happened.
- Duplicate rows in a file are surfaced as duplicates.

Five mutations were run, each caught: reporting `accepted.length`, counting
in-file duplicates as updates, unpaginating the birthday backfill, restoring the
`Promise.all` fan-out, and putting the list bound back to 1,000. The fan-out one
is measured rather than asserted — the test counts overlapping `Recipient.update`
calls through Prisma middleware, and sees 10 concurrent before the fix.

## Left for later, deliberately

An account with **no** cap can hold more than 5,000 contacts, and "add all to a
list" from such an account would still be refused. The honest fix is for the
client to send them in batches; raising the server bound further only moves the
number. Recorded rather than done, because adding untested client-side chunking
to an already-broad change is how a fix becomes a regression.
