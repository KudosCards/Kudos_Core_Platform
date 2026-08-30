# 0201 — A promise resolving does not mean it is still wanted

## Status

Accepted — implemented. From an external code review (findings 18 and 37, paired
there and here).

## Context

Two places fetched on user input and wrote whatever came back:

- **The Contacts table.** `reload()` is called from six places — search, three
  filters, sort, and the pager. Pick "January" in the birthday-month filter,
  then "March" a beat later; if January is slower its response lands second. The
  select says March, the table shows January, and `total` and `page` are
  desynced from both.
- **The send screen's contact typeahead.** Debounced, which delays the _next_
  request and does nothing about the one already in flight. Type "ab", then
  "abc": a slow "ab" repopulates the dropdown with results the sender has
  already typed past.

`await` is where this goes wrong. Nothing about a promise resolving says it is
still the one being waited for.

The codebase already knew this in two other places, which is what makes it worth
an ADR rather than a one-line fix:

- `send/recipient-picker.tsx` uses a `cancelled` flag closed over by the
  effect's cleanup.
- `send/bulk-send-client.tsx` uses a `useRef` sequence number, incremented on
  entry and checked before every `setState` — the review called its preflight
  "the best-implemented async path in the app".

So the pattern was understood twice and applied to two of four places.

## Decision

The idea is named once, as `useLatestOnly`:

```ts
const claim = useLatestOnly();
// …
const isLatest = claim();
const result = await fetch(...);
if (!isLatest()) return;
```

Both broken sites use it. `claim()` is called _before_ the request and the
returned predicate checked _after_ it — the ordering is the whole mechanism, and
putting it in a hook makes it one decision instead of a convention each call site
re-derives.

A ref, not state: claiming a turn must not itself cause a render, and the value
has to be readable by a closure created before the render that superseded it.

The `finally` blocks are guarded too. A superseded request clearing the loading
flag turns the spinner off while the newest request is still running.

### Why the two correct sites were left alone

`recipient-picker.tsx`'s cleanup flag is the right idiom for a fetch that lives
inside an effect — the cleanup runs on exactly the transition that invalidates
the request, and it handles unmount as well. Converting it to the hook would be
a change of style, not of correctness.

`bulk-send-client.tsx` implements the hook by hand. Converting it is the tidier
end state, and it was still not done here: it is the file the review singled out
as the best async code in the app, the change would be pure churn on working
code, and this branch is meant to fix a finding rather than to refactor the
thing it should have copied. Recorded so the next person can decide with the
context rather than discovering the duplicate cold.

## Consequences

- The table's contents always match the filter above them.
- The typeahead shows results for the query on screen.
- Four mutations were run, each caught: removing either guard, and making the
  hook answer always-true or always-false. The always-false case failing six
  tests is the useful signal — it says the guard is on the live path and not
  decoration.

## What this does not do

It does not cancel the request. A superseded fetch still runs to completion and
is discarded on arrival, so this fixes correctness, not bandwidth. `AbortSignal`
would do both, but it has to be threaded through `clientApiFetch` and every
caller, and getting the correctness right first is worth more than getting both
at once and neither reviewed properly.
