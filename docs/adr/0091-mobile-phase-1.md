# 0091 — Mobile friendliness, phase 1

## Status

Accepted

## Context

A full-site mobile review found a strong foundation already in place: the app
shell has a proper hamburger drawer (body-scroll lock, back-button close,
separate mobile/desktop bars), `globals.css` forces 16px inputs below 640px to
stop iOS focus-zoom, the calendar auto-switches to a list view on phones, and
the public message/RTS pages are mobile-first.

Three gaps stood out for authenticated members on a phone:

1. **The recipients list is a 7-column table with `min-w-[820px]`** — the one
   member surface that forces sideways-scrolling on a phone.
2. **No explicit viewport metadata** — the app relied on Next's implicit default
   rather than declaring `width=device-width, initial-scale=1`.
3. **The shared buttons compute to ~36px tall** (`0.5rem` padding + 20px
   line-height), below the 44px touch-target guideline, and a few call sites
   pass even tighter padding (`py-1.5 text-xs`).

This is phase 1 — the highest-traffic member surfaces. Editor touch ergonomics,
overlay/modal audits, and marketing-page polish are deferred to a later phase.

## Decision

1. **Recipients: stacked cards below `sm`.** The data table is gated to
   `hidden … sm:block`; below `sm` a `sm:hidden` stacked-card list renders the
   same rows — name (+ returned-address badge), source/status pills, DOB and
   postcode (or the "needs address" nudge) in a two-column definition list, and
   full-width Edit / Archive actions. No horizontal scroll on a phone. The
   calendar (the only other member table) already switches to a list view when
   narrow, so no change was needed there.

2. **Explicit viewport export** in the root layout: `width: "device-width",
   initialScale: 1`. Pinch-zoom is deliberately left enabled (no
   `maximumScale`/`userScalable` cap) so low-vision users can still zoom.

3. **44px buttons on touch screens, centralised.** A single `@media (max-width:
   640px)` rule sets `min-height: 2.75rem` on `.btn-accent`/`.btn-secondary`, so
   every primary/secondary button — pagination, actions, filters — meets the
   target without editing each call site, and desktop keeps its compact padding.
   The recipient cards' own tap targets (row checkbox, Edit/Archive) use
   `min-h-11`/`min-w-11` directly.

Filter *chips* (the source/status pills, the "needs address" and archived
toggles) were left at their current size: they already satisfy the AA
minimum-target-with-spacing exception, and inflating every pill to 44px would
coarsen the layout for little accessibility gain.

## Consequences

- The recipients list — the member surface most likely to be scanned on a phone
  — no longer sideways-scrolls; each contact is a self-contained card with big
  tap targets.
- One CSS rule lifts button touch targets app-wide, so future buttons inherit
  the behaviour for free; there's no per-page min-height to keep in sync.
- The stacked list duplicates the table's cell rendering. That's a deliberate,
  contained duplication (two layouts of the same data) rather than a shared
  abstraction, which would over-couple a table row to a card. If the columns
  churn, both need updating — the file keeps them adjacent so that's visible.
- Next: **phase 2** — editor touch drag/zoom ergonomics and small-control sizing,
  a modal/overlay pass (max-height + internal scroll + full-width on phones),
  and public/marketing-page polish.
