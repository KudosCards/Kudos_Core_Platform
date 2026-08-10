# 0149 — Designer: sticky page switcher + a softer "leave site?" once work is backed up

## Status

Accepted — implemented. From early customer feedback (Wave 2).

## Context

Two small-but-jarring frictions in the card designer:

1. **The page switcher (front / inside / back) was hard to find when scrolled.**
   It sits above the toolbar and canvas, so on a long editing scroll it left the
   viewport and switching pages meant scrolling all the way back up.
2. **"Adding an image triggered a browser 'leave site?' prompt."** The image
   upload itself never navigates (it's a fetch + Supabase Storage call + local
   state). What the member actually hit was the **unsaved-changes guard**: adding
   an image made the document dirty, and the next navigation (Back, refresh,
   close) fired the native `beforeunload` "leave site?" dialog — which they
   attributed to the image.

Since Wave 1c (ADR 0143), the editor **autosaves unsaved edits to `localStorage`**
and offers **restore-on-return**. That changes the calculus on the second point:
once an edit is mirrored locally, the work is recoverable, so the harsh native
prompt is largely redundant.

## Decision

1. **Make the page-switcher bar sticky** (`sticky top-0`, with a translucent
   backdrop) so front / inside / back stays reachable no matter how far the
   member scrolls.
2. **Relax both unsaved-changes guards once the edit is backed up on this
   device.** The native `beforeunload` handler and the in-app "Back to designs"
   confirm now skip when `locallyBackedUp` is true (the debounced autosave has
   mirrored the current edit to `localStorage`). So a moment after adding an
   image, navigating no longer nags — the work is safe and restorable. The guards
   still fire during the brief pre-autosave window, and in a storage-blocked
   browser (private mode) where `locallyBackedUp` never becomes true — so
   protection is retained exactly where the local backup can't cover for it.

## Alternatives considered

- **Remove the `beforeunload` guard outright.** Rejected — it's the only
  protection when `localStorage` is unavailable (private mode) or the member
  moves to another device. Gating it on `locallyBackedUp` keeps that safety net
  precisely when it's still needed.
- **Custom "leave site?" text.** Not possible — browsers show a fixed generic
  string for `beforeunload`; the only lever is whether to arm it, which is what
  we tuned.

## Consequences

- The page switcher is always one click away; adding an image (or any edit)
  stops producing a "leave site?" nag a second later, because the work is backed
  up on the device and restorable on return.
- No weakening of protection for the cases the local backup can't cover.
- Purely client-side; no API, schema, or dependency change. Builds on the Wave 1c
  autosave (ADR 0143).
