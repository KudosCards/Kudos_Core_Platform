# 0204 — Two screens, one birthday

## Status

Accepted — implemented. From an external code review (finding 33 of 37).

## Context

The API decides when a birthday falls with `nextBirthdayOccurrence`, which
handles the awkward case explicitly: a contact born on 29 February gets
28 February in a non-leap year, the conventional choice for a date that does not
exist most years.

The Contacts list computed its own answer:

```ts
const next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
```

Two problems in one line. `getMonth()`/`getDate()` are local-time getters read
off a UTC value — a `@db.Date` column arrives as UTC midnight, and west of
Greenwich those return the previous day. And `new Date(year, 1, 29)` in a
non-leap year does not throw or clamp: JavaScript rolls it forward to **1
March**.

So for a contact born on 29 February the list said 1 March, all year, while the
card was scheduled for 28 February. Two screens describing the same contact, a
day apart, with nothing to say which was right. Two live contacts are in exactly
that state today, both with occasions correctly dated 2027-02-28.

## Decision

`nextBirthdayOccurrence` moves to `@kudos/shared-types` and both sides use it.
The API's `next-birthday.util.ts` becomes a re-export, so its four call sites and
its spec are untouched — the same arrangement
`occasion-scheduling.constants.ts` already uses for the dispatch maths, and for
the same stated reason: the API owns the authoritative value, and the web must
not disagree about what it would be (ADR 0056).

The label is also formatted with `timeZone: "UTC"`. The value is a UTC-midnight
date; formatting it in a local timezone west of Greenwich prints the day before.

## Consequences

- The list and the card agree, by construction rather than by two implementations
  happening to match.
- The countdown is right too — it was a day out for these contacts, in the same
  direction.
- No data fix. The occasions were always correct; only the display was wrong, so
  the two affected contacts need nothing done to them.

Three mutations were run. Restoring the old local-time computation, and making
the shared rule roll 29 February to 1 March, are both caught.

## An uncaught mutation, recorded rather than papered over

Removing `timeZone: "UTC"` from the label is **not** caught: CI and the local
test environment both run in UTC, so local and UTC formatting are identical
there. Exercising it would mean forcing a process timezone west of Greenwich for
one test file, which Node caches per process and which does not fit this suite.

The guard is kept anyway. It costs nothing, it is correct, and Kudos is a UK
platform — so it is defensive against a customer travelling or a browser
misreporting, rather than load-bearing. Saying so is better than implying the
test set covers it.
