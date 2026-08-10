# 0150 — Make the "upload your own artwork" upgrade CTA legible

## Status

Accepted — implemented. From early customer feedback (Wave 2).

## Context

On the Designs page, uploading your own artwork is a paid entitlement
(`customArtworkEnabled`). Members who have it see a prominent coral **"Upload
your own artwork"** button; members who don't saw an **upgrade** link instead —
but styled as a quiet grey bordered link (`border-border`, muted weight). Early
feedback: that tier-locked affordance **"fades into the background"**, so the
upsell — a real revenue path — went unnoticed next to the surrounding UI.

## Decision

Restyle the locked-state CTA as a legible, intentional upsell rather than a faint
secondary link: accent-tinted (`bg-accent-soft`, `border-accent/40`,
`text-accent`, semibold) with a 🔒 affordance and the existing arrow, linking to
`/billing`. It now clearly reads as "this is a premium feature — upgrade to
unlock it".

## Consequences

- The upgrade path is visible and enticing instead of disappearing, so a
  free-plan member actually sees the option (and the reason to upgrade).
- The paid "Upload your own artwork" action is unchanged.
- Purely presentational (class + a lock glyph); no entitlement, route, API, or
  dependency change. The gate itself (`customArtworkEnabled`) is untouched.
