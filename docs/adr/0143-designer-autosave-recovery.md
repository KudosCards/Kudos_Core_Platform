# 0143 — Card designer: never lose a design (local autosave + honest save-failure recovery)

## Status

Accepted — implemented. From early customer feedback (Wave 1).

## Context

Two pieces of early feedback both pointed at the same wound in the card editor —
**work getting lost**:

1. _"It timed out and I lost my whole design."_ A Supabase session expires while
   someone is laid out mid-card; the next Save is a **401**. The old editor
   surfaced that as a single red line (`setError`) that scrolled away, and the
   in-memory design was the only copy — close the tab and it was gone.
2. _"I got an error, pressed back, and the page broke."_ Any save/send failure
   left the member with a dead-end message and no obvious next step, so the
   instinct was to navigate away — losing the edits.

The editor already had the right _instincts_ (a `beforeunload` guard, an in-app
"unsaved changes" confirm), but they only cover navigation. Nothing protected
against a **failed save** or a **dead tab**, and the failure copy gave no path
back. The design document lives entirely in React state until a successful
`PATCH /saved-designs/:id`.

## Decision

Make lost work structurally impossible for a single-device session, and turn a
save failure into a reassuring, actionable state rather than a dead end.

### 1. Debounced local autosave (the safety net)

Unsaved edits are mirrored into `localStorage` (`kudos:design-draft:<designId>`),
debounced ~1s after typing settles. This is a **best-effort backup**, never
load-bearing: every read/write is wrapped so corruption, a full quota, or a
storage-blocked browser (private mode) can only ever no-op — the editor never
breaks over a bad draft. The draft is **cleared on a successful server save**,
so localStorage never masquerades as the source of truth.

### 2. Restore-on-return

On mount, if a stored draft differs from the server copy, an amber banner offers
**Restore** / **Discard** — so a member who timed out, crashed, or hit Back gets
their work handed back on the next visit instead of silently losing it. Reading
localStorage is a mount-time effect (it can't run during render: SSR has no
`localStorage`, and a lazy `useState` initialiser would hydration-mismatch).

### 3. Honest, actionable save failures

Save/send failures now raise a **persistent** banner (not a disappearing line)
via a single `reportSaveFailure` helper:

- A **401** is named for what it is — _"Your session timed out, so we couldn't
  save"_ — and the banner reassures that **the work is backed up on this
  device** and tells them exactly what to do (sign in again in another tab, come
  back, press Save). No dead end.
- Any other failure shows the API's message with the same "backed up locally"
  reassurance and a **Try saving again** button.

The status chip likewise reads _"Unsaved · backed up on this device"_ once the
draft is mirrored, so the safety net is visible, not just present.

## Alternatives considered

- **Server-side autosave / draft revisions.** The robust long-term answer, but a
  new endpoint, schema, and conflict story — disproportionate to "stop losing
  work today", and it wouldn't help once the session is already 401'd. localStorage
  needs no auth and survives exactly the timeout case that prompted this.
- **Silent auto-restore.** Rejected — overwriting what's on screen without
  consent is its own way to lose work. The member chooses Restore vs Discard.
- **A silent token refresh on 401.** Worth doing eventually, but orthogonal:
  the backup + clear recovery path is what guarantees no data loss regardless of
  whether a refresh later lands.

## Consequences

- A timeout, crash, accidental Back, or failed save on the **same device** no
  longer loses a design — it's recoverable on return, and the failure state
  tells the member their work is safe and what to do next.
- Not cross-device (localStorage is per-browser) and not a version history — a
  deliberate scope line; server-side drafts remain the future upgrade.
- "Backed up" is derived from state during render (a snapshot comparison), not an
  effect-synced flag, so the chip can't drift out of sync with the actual draft.
- No API, schema, or dependency change — entirely within the editor client.
