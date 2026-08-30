# 0199 — One selection, one meaning

## Status

Accepted — implemented. From an external code review (finding 20 of 37).

## Context

Contacts held its bulk selection as a `Set<string>` of ids, and `reload()` never
cleared it — so ticks survived pagination, deliberately. The bar reads
"90 selected" and the "Send a card to 90 →" link genuinely carries all ninety.

Two of the four actions in that same bar did not. `bulkArchiveOrRestore` and
`exportSelected` both began by intersecting the selection with `recipients` —
the rendered page — because a `Set` of ids is not enough to export a row or,
as it was written, to archive one.

Tick all on three pages of thirty. The bar reads "90 selected". Export produces
thirty rows. Archive archives thirty, then clears every tick as though all
ninety were done. Same toolbar, same selection, two meanings, and no way to tell
from the screen which action means which.

The right shape was already in the codebase, next door, with a comment saying
why. `bulk-send-client.tsx` holds its selection as a `Map<string, Recipient>`:

> The chosen contacts, keyed by id and holding the full record, so a selected
> contact keeps its address/preview even when it's off the current picker page.

## Decision

Contacts uses the same `Map<string, Recipient>`. Export reads
`selected.values()`, archive reads `selected.keys()`, and neither has to consult
the rendered page to find out what was ticked.

The alternative the review also offered — clear the selection on pagination and
label it page-scoped — was rejected. It would fix the disagreement by removing a
capability that already worked: selecting across pages and sending to all of
them is the flow the send link exists for. Making the two broken actions match
the two working ones is the direction that keeps what the product can do.

## Consequences

- All four bulk actions mean the same thing by "selected", and the count is true
  for each of them.
- A failed archive part-way through leaves only the un-archived contacts ticked
  (`dropFromView` already removes each one as it lands), so a retry does not
  redo work.

## The trap in changing the shape

Two call sites spread the selection directly — `[...selected].join(",")` for the
send link, and `[...selected]` for add-to-list. Spreading a `Set` gives ids;
spreading a `Map` gives `[key, value]` pairs. Both compile, both produce an array
of the right length, and both quietly send rubbish: the link becomes
`/send?recipients=r-1,[object Object],r-2,…`.

Neither had a test. They do now, and the tests assert contents rather than
counts — a first draft asserted `toHaveLength(32)` and passed happily on
thirty-two entry pairs. Five mutations were run in total, each caught: both
actions re-intersected with the page, both spreads reverted, and the
page-scoped alternative applied.
