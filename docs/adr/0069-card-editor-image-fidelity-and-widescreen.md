# 0069 — Card editor: image fidelity and a widescreen canvas

## Status

Accepted

## Context

Two card-designer complaints from the user-feedback batch:

- **#11 Images came out distorted.** An uploaded photo was inserted at a fixed
  **150×150 square** regardless of its real shape, and the width/height panel
  inputs moved independently — so a portrait or landscape photo was squashed the
  moment it was placed, and easy to stretch further while resizing. For a
  product whose whole promise is "the very best possible outcome" on a printed
  card, a warped photo is the worst kind of defect.
- **#12 The editor wasted widescreen space.** The canvas was hard-capped at
  450px (the card's authored width) and never scaled above 1×, so on a large
  monitor the user worked on a small card with a sea of empty space around it.

## Decision

**Preserve aspect ratio, don't fabricate one.**
- On insert, the editor reads the file's natural pixel dimensions in the browser
  (`readImageSize`) and scales them to fit within a 200-unit box while keeping
  the ratio (`fitWithinBox`). The placed element already looks right — no
  reshaping needed.
- Resizing defaults to **aspect-locked**: changing width recomputes height from
  the element's current ratio (and vice versa), so a photo can't be stretched
  out of shape by accident. A "Lock aspect ratio" checkbox lets a user turn it
  off for deliberate stretching. This needs no schema change — the ratio is
  derived from the element's stored width/height, so existing designs keep
  working and reopen correctly.

**Let the canvas grow on wide screens.** The Stage now scales up to
`MAX_CANVAS_SCALE` (1.42×, ≈640px) instead of being capped at 1× — Konva
re-renders text and shapes crisply at any scale, and images are preview-only
(print still uses the original asset at full resolution). The container
max-width is raised to 640px in step, and the controls panel becomes a slightly
wider, `sticky` sidebar on large screens so it stays in view beside the taller
card.

## Consequences

- Photos keep their true shape from the moment they're dropped in, and can't be
  silently distorted while resizing — the default that produces the best print
  outcome is also the easy one.
- The editor uses the room a desktop gives it: a materially bigger working
  canvas with the tools parked alongside, without breaking the phone layout
  (still scales down to fit, still no horizontal scroll).
- No data-model change: the aspect fix is purely in how new elements are sized
  and how the resize inputs behave; the scale change is view-only.
- Follow-ups from this feedback area still open: a reusable **saved-assets**
  library so an uploaded image can be placed again without re-uploading (#16),
  and broader shop/browse improvements (#10).
