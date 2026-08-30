# 0182 — A backup that didn't happen is not a backup

## Status

Accepted — implemented. From an external code review of the design editor
(finding 5 of 37).

## Context

The editor mirrors unsaved edits into `localStorage` on a 1-second debounce, so
a session timeout, a crash or an accidental Back can be recovered from (ADR
0143). One derived boolean, `locallyBackedUp`, decides three things:

1. the status chip — _"Unsaved · backed up on this device"_;
2. whether the `beforeunload` guard is attached;
3. whether the in-app "Back to designs" link confirms before navigating.

Dropping the guards once the work is mirrored is deliberate and good: the
native "leave site?" prompt is genuinely redundant when the edit is restorable,
and nagging a second after every image insert is noise.

The problem was that `locallyBackedUp` could not tell whether the mirror had
happened:

```ts
function writeDraft(designId: string, draft: DesignDraft): void {
  try {
    window.localStorage.setItem(draftKey(designId), JSON.stringify(draft));
  } catch {
    /* Storage full or blocked — a best-effort backup, never fatal. */
  }
}

// …later, in the debounce:
writeDraft(savedDesign.id, { name, document: document_, ts: Date.now() });
setBackedUpSnapshot(snapshot); // unconditional
```

`writeDraft` returns `void`. The write throws on a quota-full or
storage-blocked browser — and `setBackedUpSnapshot` runs anyway. So in private
mode, or once the document outgrows the quota:

- the chip says the work is backed up on this device;
- **both** leave-guards come off, because `locallyBackedUp` is true;
- `readDraft` finds nothing on return, so no restore is offered;
- the work is gone.

The code's own comment claimed the opposite behaviour — _"(and a storage-blocked
browser, where `locallyBackedUp` never becomes true) still gets it"_ — which is
the fourth place in this review where a comment describes the correct behaviour
and the code beside it does something else.

The sharpest instance was the save-failure banner, which stated
**unconditionally**:

> Your work is backed up on this device, so nothing is lost

That is the moment the reassurance carries the most weight and does the most
damage if untrue: the save has just failed, and the member is being told not to
worry while their only copy is in a tab they may well close.

## Decision

`writeDraft` returns whether the write actually landed. It still never throws —
a failed mirror must not break the editor — but it never claims success either.
The editor sets `backedUpSnapshot` only on a real write, so `locallyBackedUp`
becomes truthful and both guards stay on by themselves.

A refused write is its own state, distinct from "not mirrored yet". There is no
later moment at which such an edit becomes safe on its own, so the member is
told plainly — an amber _"Unsaved · can't back up on this device — save now"_ —
rather than left with a chip that silently never changes. The save-failure
banner reads the same state and tells them to keep the tab open instead of
promising a backup that isn't there.

### Extracted to be testable

The draft helpers move to `lib/design-draft.ts`. The editor imports the Konva
canvas and had never been mounted in a test, which is exactly why a function
that lied about its own success went unnoticed for so long. The extracted module
has direct tests for the failure modes; the editor itself is now mounted in
jsdom (the canvas arrives through `next/dynamic`, so it can be stubbed) to
assert the chip text and the leave-guard behaviour in both worlds.

## Consequences

- Two mutations, each caught: making `setBackedUpSnapshot` unconditional again
  fails the two "browser refuses storage" tests; making `writeDraft` report
  success on a throw fails four.
- The guards need no separate fix — they were already keyed to
  `locallyBackedUp`, and simply became correct once it stopped lying.
- Mounting the editor for the first time surfaced a duplicate-key warning in
  `FontPreloader`, keyed on the CSS family that `next/font` generates. **This is
  a test-environment artefact, not a production bug** — under a runner that
  stubs `next/font`, every family resolves to the same string. Keyed by position
  now, since the list is fixed-length and never reordered, and an opaque
  generated value was a poor identity regardless.
- Not addressed: the editor still has no upper bound on document size, so the
  quota case remains reachable rather than merely possible. Warning honestly is
  the fix for being unable to back up; not needing the quota in the first place
  is a different piece of work.
