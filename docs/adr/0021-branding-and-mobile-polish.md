# ADR 0021 — Logo/branding everywhere + mobile polish

Status: accepted
Date: 2026-07-22

## Context

The logo (`/marketing/logo.png`) was only on the marketing site and the public card library. The
authenticated app and the entry pages showed a plain **text** wordmark ("Kudos Cards"), and the
browser tab had the default framework favicon. A pass across the site on a phone also surfaced a few
layout spots that could overflow a narrow viewport.

## Decision

**Branding.** A single reusable `<Logo>` component (`components/logo.tsx`, height-constrained so it
scales in any bar) now renders the mark in every relevant chrome location:

- **Auth pages** (login / register) — the logo replaces the text wordmark above the card, linking
  home.
- **App shell** — the desktop sidebar header and the mobile top bar both show the logo, linking to
  the dashboard.
- **Onboarding** — logo above the account-setup form.
- **Favicon** — `metadata.icons` points at the logo, so the browser tab is branded.

The marketing landing and public card library keep their own inline logo usages (bespoke sizing for
those looks); this component is for the app chrome.

**Mobile polish.** Fixes to the spots a phone-width review flagged:
- Design editor: the header (title + Save + Send) now wraps; the fixed-size print canvas scrolls
  inside its own box instead of breaking the page; the properties panel goes full-width on mobile.
- Recipients: the add-recipient field grid stacks to one column on the narrowest screens.

The mobile *shell* was already sound (slide-in drawer nav, scrollable tables, responsive grids from
earlier passes), so this was targeted tidying, not a redesign.

## Alternatives considered

- **A dedicated square favicon asset.** Deferred — the logo is portrait, so as a tab icon it's
  letterboxed. Good enough for now; a purpose-made square/monochrome icon can drop in later without
  code changes (swap the `icons` target).
- **Making the card editor fully touch-friendly on mobile.** Out of scope — the canvas is a
  fixed print-size editing surface and a desktop-first tool. We ensure it degrades gracefully
  (scrolls, doesn't break layout) rather than rebuilding it for touch.

## Consequences

- Purely presentational — no API, schema, or test-surface change.
- Any future brand refresh is a one-file swap (`components/logo.tsx` + the asset) for all app chrome.
