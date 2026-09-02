# 0227 — A summary whose parts do not add up

## Status

Accepted — implemented. From the follow-up review's finding 9 (reporting).
Follow-up to ADR 0214.

## Context

A CRM sync answered with this:

> Imported 0 new, 97 updated (of 100 fetched).

in green, and stored `lastSyncStatus: "ok"` on the connection. Three contacts
went in and never came out, and nothing anywhere said so. The customer's only
possible reading is that 100 is the number that matters and 97 is a detail.

There were three separate ways for a contact to leave the arithmetic, and the
code knew about all three:

**Rows the mapper could do nothing with.** `mapBrevoContact` (and its HubSpot
and GoHighLevel siblings) returns `null` when a contact has no first or last
name, and the fetch filters those out:

```ts
const contacts = raw.map((c) => mapBrevoContact(c, mapping)).filter((c) => c !== null);
return { contacts, fetched: raw.length, truncated };
```

`fetched` counts the rows before the filter and `contacts` after it. **Nothing
counted the difference.** This is not an edge case — a marketing list full of
email-only subscribers is the ordinary shape of the thing we are reading, so
most real syncs drop some.

**Contacts refused on update.** ADR 0186 made the update loop report a dedupe
collision per contact rather than abort the whole sync. Those went into
`errors`, correctly — but `skipped` was computed only from the _create_ side:

```ts
const dedupeSkipped = toCreate.length - capSkippedIds.length - createdCount;
const skipped = capSkippedIds.length + Math.max(0, dedupeSkipped);
```

so a contact refused on the way in was neither `updated` nor `skipped`. It was
nothing.

**Duplicate external ids within one payload**, collapsed before the lookup and
never mentioned again.

And `errors` — the one field that carried a per-contact _reason_ — was returned
by the API, typed in the shared schema, and **rendered nowhere**. It had never
been on screen.

Over all of that sat:

```ts
lastSyncStatus: truncated ? partialSyncStatus(fetched) : "ok";
```

The pull completing is not the sync succeeding. For the nightly sweep this
distinction is the whole thing: nobody is watching, no summary panel is ever
rendered, and that string is the _only_ record the run leaves behind.

## Decision

**One invariant, stated and tested:**

```
fetched === created + updated + skipped + duplicates + unmappable
```

- `unmappable` is `fetched - contacts.length`, computed once in `sync` rather
  than in each provider — all three report `fetched` as the raw row count and
  `contacts` as what survived mapping, so the difference means the same thing in
  every one.
- `duplicates` comes out of `ingestFromSource`, which is where the collapse
  happens.
- `skipped` now includes the update refusals. They are the one class of skip
  that is also named per-id in `errors`.

**"ok" means what it says.** `syncStatus()` returns `"ok"` only when nothing was
lost, and otherwise says how much and why:

> incomplete: 3 of 100 contacts were not imported — 3 with no first or last name

Truncation still outranks the rest, because it means contacts we never saw at
all — the counts then describe a sample rather than an address book.

**The reasons are rendered.** The summary panel lists the per-contact refusals
(five, then a count), so the customer can go and fix the right contact. It is
amber whenever anything did not arrive, not only when the pull was cut short.

**The optimistic label was fixed too.** The client writes a `lastSyncStatus`
into local state so the "Last synced" line updates before the next page load,
and it was `truncated ? PARTIAL : "ok"` — so it put "ok" on the line directly
beneath a panel saying three contacts had not arrived, and disagreed with what
the server had just stored. Same defect, one call site over, and the third time
that pattern has come up in this round of work (ADRs 0221, 0224, 0226).

## Consequences

- The counts add up, and a guard test asserts the invariant rather than the
  individual numbers, so a new way to lose a contact fails the test.
- A nightly sync that drops contacts leaves a trace that says so.
- Seven mutations, each caught: forcing the status to "ok", dropping the update
  refusals from `skipped`, zeroing `duplicates`, zeroing `unmappable`, letting
  the panel stay green, not rendering the reasons, and restoring the optimistic
  "ok".

**Unmappable rows are counted, not named**, and that is a deliberate stop. The
external id exists on the provider row but the mapper discards it when it
returns `null`, so naming them means reshaping three mappers to report a reason
per row. The customer's action is the same either way — add the missing names in
the CRM — so the count and the reason carry most of the value. Naming them is
worth doing separately.

## Two tests that were not testing what they said

Both surfaced when the status stopped being unconditional.

`hubspot.e2e-spec.ts` had **"a complete pull still reports a clean success"**
asserting `lastSyncStatus === "ok"` — against the default fixture, whose third
contact has no surname. The pull it called complete was missing a contact. It
passed because the status was `"ok"` no matter what the ingest made of the pull,
which is the defect it was sitting next to. It now filters the fixture to the
complete pull it describes.

`crm-connections.e2e-spec.ts` had **"syncs Brevo contacts … (skipping
unaddressable ones)"** asserting `skipped: 0`. The word in the title and the
number in the assertion were describing different things, and the gap between
them was the finding.

A test whose name and fixture disagree does not fail. It sits there being green
about something nobody checked.
