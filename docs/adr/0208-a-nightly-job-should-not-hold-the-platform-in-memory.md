# 0208 — A nightly job should not hold the platform in memory

## Status

Accepted — implemented. From an external code review (finding 28 of 37).

## Context

`collectReferencedPaths` gathers every storage path any database row still
refers to, so the reaper only deletes what nothing points at. It did so with
three unbounded, platform-wide reads, fired together:

```ts
const [assets, cardDesigns, savedDesigns] = await Promise.all([
  this.prisma.designAsset.findMany({ select: { url: true } }),
  this.prisma.cardDesign.findMany({ select: { thumbnailUrl: true, document: true } }),
  this.prisma.savedDesign.findMany({ select: { document: true } }),
]);
```

Two of them pull whole JSON design documents, and each is then `JSON.stringify`d.
At 50,000 saved designs averaging 15 KB that is roughly 750 MB of row buffers
plus an equal transient copy, on a container also serving customer traffic, at
03:00, unattended.

When it OOMs, the scheduler catches the rejection and logs it. The visible
symptom is one log line and a reaper that quietly never reclaims anything again
— the storage bill grows and nothing says why.

## Decision

Each table is read a page at a time, keyset-paginated on the primary key, and
only the extracted paths are kept. The documents are not needed after
`addExtractedPaths` has run over them, so a page's worth is the working set
rather than the whole platform's.

Sequential rather than concurrent, deliberately: three pages resident at once is
three times the peak for no gain on a job with all night to run.

## What the test does and does not prove

The failing-test-first discipline does not apply cleanly here, and it is worth
being exact about why.

The defect is memory exhaustion at 50,000 designs. Reproducing it would mean
seeding hundreds of megabytes of documents, which is not a test anyone should
run in CI. The evidence for the fix is the shape of the code: three unbounded
reads became paged ones.

What the new test guards is the risk the fix _introduces_. This reaper deletes
storage objects, so a row the scan fails to read is a live asset deleted — a
paging bug here loses customer artwork. The test fills a page, records a
referenced asset with an id that sorts after everything in the table, and checks
the object is still kept. Ids are assigned explicitly because the first version
left them to `uuid()` and the row landed on page one about as often as not: a
test that only sometimes exercises paging proves nothing, and it passed against
every mutation until the ordering was pinned.

Four mutations were then run. Stopping after the first page is caught — that is
the one that loses data. Advancing the cursor to the wrong row and dropping
`skip: 1` are **not** caught, and should not be: both re-read rows they have
already seen, which costs time and reads nothing wrongly. Removing `orderBy` is
also not caught; without it Prisma's cursor has no stable order to page against,
but Postgres happens to return a small table in an order that hides it. That
last one is a real latent risk that a test cannot force, so it is recorded here
rather than counted as covered.
