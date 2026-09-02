# 0232 — A claim outliving what it claims

## Status

Accepted — implemented. From the follow-up review's N10. Second half of ADR 0182.

## Context

The editor mirrors unsaved work to `localStorage` and tells the member so —
_"Unsaved · backed up on this device"_ — and on the strength of that claim it
drops the browser's leave prompt and the in-app "unsaved changes" confirm. The
claim is derived rather than stored, deliberately:

```ts
const locallyBackedUp = isDirty && backedUpSnapshot === currentSnapshot;
```

ADR 0182 fixed the write side: `setBackedUpSnapshot` used to run whether or not
the `localStorage` write had thrown, so a browser refusing storage was told its
work was safe and had both guards taken off it.

**The clear side was never fixed.** Two places throw the mirror away —
`persist()` after a successful save, and Discard on the recovery banner — and
both called `clearDraft` without touching `backedUpSnapshot`. The claim outlived
the thing it claimed.

Reaching it takes no unusual sequence. Open a design carrying a draft from a
previous session, make an edit, let the one-second autosave mirror it, then
Discard the old draft: the store is empty, `backedUpSnapshot` still names the
current edit, so the chip reads _backed up on this device_, the leave guard is
off, and a refresh loses the work. The same thing happens after a save — edit,
let it mirror, edit again without waiting, save, then return to the mirrored
state: dirty, claimed, and nothing in storage.

The window closes at the next debounced write, about a second later, which is
why it is easy to miss and why nobody would connect the loss to the click that
caused it.

## Decision

One function does both halves, so they cannot come apart:

```ts
function forgetLocalBackup() {
  clearDraft(savedDesign.id);
  setBackedUpSnapshot(null);
}
```

Both call sites use it. There is no longer a way to clear the store without
clearing the claim, which matters more than the fix itself: the next place that
needs to throw a draft away will reach for this rather than for `clearDraft`.

## Consequences

- The chip and both leave guards agree with what is actually in storage, at
  every point in the cycle rather than only after a write.
- Two mutations, each caught: clearing the store without the claim, and Discard
  no longer clearing at all.
- The test seeds a previous-session draft so the recovery banner is on screen —
  the Discard button does not exist otherwise, which is why this path had no
  coverage.

## The pair, from both ends

ADR 0182 was the write side of one idea: **a claim about durable state must be
derived from that state, not asserted alongside it.** This is the clear side,
and it sat open for as long, in the same component, one function away from the
code that fixed the other half.

Deriving `locallyBackedUp` at render time — rather than syncing a boolean in an
effect — was the right call and is why the chip is honest the rest of the time.
But `backedUpSnapshot` is still a copy of a fact whose original lives in the
browser's storage, and a copy has to be maintained at _every_ place the original
changes. The write side was one of those places; the clear side was two more.
