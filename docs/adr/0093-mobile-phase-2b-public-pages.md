# 0093 — Mobile friendliness, phase 2b: public pages

## Status

Accepted

## Context

Phases 1 and 2 (ADRs 0091, 0092) covered the authenticated app. Phase 2b sweeps
the public, logged-out surfaces — the front door for a visitor's first
impression, often on a phone from a shared link or ad.

Reviewing them, the pages themselves were already responsive: the marketing
landing page collapses its `md:grid-cols-2` sections to one column and scales its
type; the `/cards` gallery is `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` with
snap-scrolling category carousels and responsive `Image` sizes; the card detail
page stacks on mobile; and the `(auth)` layout is a centred `max-w-sm` card with
the 16px inputs from ADR 0091. The gaps were concentrated in the shared
`PublicHeader` and one touch-only affordance:

- **The header nav links were `hidden md:flex` with no mobile fallback.** On a
  phone a visitor could not reach the card library / plans / section anchors from
  the header — there was no hamburger.
- **Header actions were 32–36px** — the Reminders and Basket icon buttons
  (`px-2 py-1`) and the Sign-in pill (`px-3 py-2`), below the 44px touch target.
- **The gallery tile's "Personalise this card" pill is `group-hover` only**, so
  it never appeared on touch devices (which have no hover) — a mobile visitor saw
  no call-to-action on the tile, only the image and name.

## Decision

1. **Mobile nav in `PublicHeader`.** A `md:hidden` hamburger opens a dropdown of
   the same `navLinks`, with the outside-click / Escape close pattern already
   used by the header's Reminders prompt. Desktop keeps its inline `md:flex` nav
   unchanged. The hamburger and each menu item are ≥44px.

2. **44px header actions.** The Reminders and Basket buttons and the Sign-in pill
   gain `min-h-11` (with flex centring), so every header control is finger-sized.
   These are bespoke marketing-styled controls (coral accent, not the app's
   `.btn-*`), so they're raised individually rather than via the shared button
   rule from ADR 0091.

3. **Touch-visible gallery CTA.** The tile's personalise pill adds
   `pointer-coarse:translate-y-0 pointer-coarse:opacity-100`, so on a touch device
   it's shown by default (the whole tile was always tappable; now the affordance
   is visible too). Hover behaviour on desktop is unchanged.

## Consequences

- A phone visitor can now navigate the public site from the header, taps land on
  finger-sized controls, and the card gallery shows its call-to-action instead of
  hiding it behind a hover that never fires.
- Desktop is unchanged: the inline nav still shows at `md`, the hover-in pill
  still animates, and the enlargements are either `md:hidden` or `pointer-coarse`.
- The public pages needed no structural/responsive changes beyond the header and
  that one affordance — the grids and layouts were already sound.
- This completes the planned mobile pass. Optional future work: ops/admin table
  stacked layouts (internal, lower priority).
