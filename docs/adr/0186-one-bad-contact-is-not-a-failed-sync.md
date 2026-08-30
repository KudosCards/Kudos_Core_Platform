# 0186 — One bad contact is not a failed sync

## Status

Accepted — implemented. From an external code review (finding 9 of 37). Last of
the Priority 1 block.

## Context

`ingestFromSource` creates new contacts and refreshes matched ones. The create
half runs inside `runSerializable` and absorbs a dedupe collision deliberately:

```ts
// skipDuplicates absorbs the case where a create collides with the
// name+postcode+DOB dedupe key of an *existing* recipient from another
// source, instead of a raw P2002 aborting the whole ingest.
await tx.recipient.createMany({ data: accepted, skipDuplicates: true });
```

The refresh half, a few lines below, had no such guard:

```ts
for (const contact of toUpdate) {
  await this.prisma.recipient.update({
    where: { id: idByExternalId.get(contact.externalId) },
    data: this.toUpdateInput(contact),
  });
}
```

No transaction, no try/catch — and `toUpdateInput` writes **every column of the
dedupe key**: `firstName`, `lastName`, `addressPostcode`, `dateOfBirth`. So an
edit in the source CRM that makes one contact the same person as another raises
P2002 on that iteration.

The loop aborts. Contacts before it are already committed; contacts behind it
never run. The audit entry and the birthday scheduling never run either. The
request 500s, and `CrmConnectionsService.sync` records:

```
lastSyncStatus: "error: Unique constraint failed on the fields: (…)"
```

— a raw Prisma constraint string, on the customer's integrations page, every
night, for ever. Nothing about it changes on the next run, because the input
that caused it is still in the CRM.

Reproduced end to end: three contacts sharing a postcode and date of birth, the
second renamed in the CRM to match the first. The refresh 500s, and the third
contact — queued behind the collision — is never updated.

The same shape as finding 8, one file apart: one door locked and the other not.

## Decision

Isolate each contact, and report rather than throw.

A unique-key collision here is not a system failure. It is a statement about the
data: these details now make this contact the same person as one already on
file. So the contact is left exactly as it was — a refusal, not a partial write
— and named in the `errors` array that `IngestResult` already carries for the
plan-cap case, with a reason a customer can act on at source. Anything that is
_not_ a unique-key collision is still thrown, because a genuine database failure
must not be reported as a tidy per-contact skip.

`isUniqueConstraintViolation` is shared with `mapWriteError`, so the path that
reports the collision and the path that maps it to a 409 cannot drift on what it
looks like.

### The counts now mean what they say

`updated` was reported as `toUpdate.length` — the number of contacts _attempted_.
With failures now possible and survivable, that would overstate the work done, so
it counts the writes that actually landed. `ensureScheduledBirthdays` keys off
the same number rather than the attempt count.

## Consequences

- A nightly sync completes and records `ok`, with the problem contacts named,
  instead of failing wholesale and repeating the failure indefinitely.
- Contacts behind a collision are synced, which they never were.
- Two mutations, each caught: rethrowing instead of reporting (2 tests), and
  swallowing the collision without recording it (1 test).
- **Not addressed here.** `toUpdate` is still an unbounded `Promise`-free serial
  loop of one `UPDATE` per matched contact. Finding 27 covers the fan-out and
  chunking of the import paths and will revisit this loop's shape; this change
  deliberately does not alter its concurrency, only its failure behaviour.
