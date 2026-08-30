# 0197 — Cancel must cancel

## Status

Accepted — implemented. From an external code review (finding 17 of 37).

## Context

Marking a card posted is a one-way door. `postedAt` is stamped, the row leaves
the fulfilment queue, and the product offers no reverse transition: the only
action left on a posted card is "Returned to sender", which opens a recovery
case and flags the contact's address.

Standing in front of that door was a prompt for the optional tracking reference,
written the same way in two places:

```ts
const tracking = window.prompt("Tracking reference (optional):") ?? "";
if (tracking.trim()) body.trackingReference = tracking.trim();
// no return — the transition fires regardless
```

`window.prompt` answers `null` on Cancel or Escape and `""` on a blank submit.
Those are different answers: one is "post it, no reference", the other is "I
didn't mean to click that". The `?? ""` folded the second into the first, so an
operator who clicked the wrong row and pressed Escape to back out posted the
card anyway.

The two copies are the point. The same four lines sat in the fulfilment queue
and again in the order cockpit, and the bug was in both — because a decision
written twice is a decision nobody owns.

## Decision

The distinction lives in one named function, `promptTrackingReference`, which
returns `null` for "backed out" and an object — possibly empty — for "answered".
Both call sites read:

```ts
const tracking = promptTrackingReference();
if (!tracking) return;
Object.assign(body, tracking);
```

The early return sits inside the existing `try`, so the `finally` still clears
the row's pending state and the button does not stay stuck.

## Consequences

- Escape and Cancel leave the card in the queue, where the operator left it.
- A deliberately blank answer still posts, with no tracking reference — which is
  what "(optional)" promises.
- The null-versus-empty-string distinction is stated once and unit-tested,
  rather than re-derived at each call site.

Four mutations were run, each caught: folding `null` back into an empty result
in the helper, dropping the early return in the fulfilment queue, dropping it in
the order cockpit, and removing the trim. Both call sites have a component test
that clicks the real button with `window.prompt` stubbed — "the other copy was
fixed too" is the kind of claim that needs a test rather than a reading of the
diff.

## Two things deliberately not changed here

**`window.prompt` itself.** The app already has `NameDialog`, whose docstring
calls it "the app's replacement for `window.prompt`" — these two ops screens are
the leftovers, and `window.prompt`'s null-or-string API is what made this bug
possible. Replacing it would mean a modal, new state in both components, and an
`allowEmpty` affordance on a dialog currently used in four places that all
require a value. That is a UI change to two ops screens, not a bug fix, and it
should be decided on its own terms.

**The bulk "Mark posted" button.** Found while writing the test: `bulkAdvance`
posts every selected card with no prompt and no confirmation at all. It has no
cancel bug because it never asks — but it walks through the same one-way door
for N cards on a single click. That is a separate finding, unreported by the
review, and it is recorded here rather than fixed silently.
