# 0077 — Image LCP polish + Lighthouse measurement

## Status

Accepted

## Context

A site-speed review (follow-up to ADR 0076) checked the remaining items on the
performance backlog against what had already shipped. Most were already done:
the client bundle is code-split and audited (ADR 0047), per-navigation fetch
waterfalls are gone (ADRs 0076 + 0043), public catalog pages are ISR/CDN-cached
(ADR 0044), and card thumbnails already carry real `sizes` (ADR 0045). Doing any
of those again would be pure duplication.

Two genuine gaps remained:

1. **Image LCP polish.** The five `thumbnailUrl` images had `sizes` but no
   loading `priority` and no placeholder. The product-page hero (`/cards/[id]`)
   and the guest-send hero (`/cards/[id]/send`) are each their route's LCP, yet
   loaded lazily like any other image. And every card thumbnail popped in from
   blank once it arrived over the network.
2. **No automated measurement.** ADR 0042 shipped the `Server-Timing` header,
   but nothing captured Lighthouse/LCP numbers — so speed work was being judged
   by feel, not data. The backlog's Phase 0 explicitly left "capture Lighthouse
   for the heaviest pages" open.

## Decision

**1. `priority` on the two LCP heroes.** `/cards/[id]` and `/cards/[id]/send`
mark their single hero image `priority`, so it loads eagerly instead of lazily.
Deliberately *not* applied to the catalog/designs grids — priority-loading a
whole grid would defeat lazy-loading and hurt, not help; grids stay lazy.

**2. A shared blur placeholder.** `CARD_BLUR_DATA_URL` in `lib/card-image.ts` —
one tiny inlined 2:3 SVG (no per-image work, costs nothing) — is used as
`placeholder="blur"` on all five thumbnails (cards gallery, product hero,
guest-send hero, basket, designs gallery). The box fills with a soft grey
immediately and the real image fades over it, so perceived load is steadier and
there's no blank-then-pop. Works for both optimized and `unoptimized` images.

**3. A non-blocking Lighthouse workflow.** `.github/workflows/lighthouse.yml`
runs `treosh/lighthouse-ci-action` on the public home + `/cards` pages, on a
weekly schedule and on-demand (`workflow_dispatch`). It reads the target from a
`LIGHTHOUSE_BASE_URL` repo variable and no-ops if unset — the same tolerant
pattern as the keep-warm workflow (ADR 0076 phase 4). It uploads the full HTML
reports as artifacts and prints a shareable link. It is **not** a PR gate:
Lighthouse over the network is noisy, and a flaky score must never block a
merge. Only public (no-login) pages are profiled, since Lighthouse can't
authenticate — which are exactly the pages a first-time visitor lands on.

## Consequences

- The two public product heroes paint their main image sooner (eager load);
  every card thumbnail fades in from a neutral placeholder rather than blank.
- We get a weekly Lighthouse trend line (and an on-demand run to profile a
  deploy preview before shipping) without adding a flaky gate to CI.
- One-time setup: add the `LIGHTHOUSE_BASE_URL` repo variable. Until then the
  workflow no-ops.
- Explicitly **not** done (would duplicate shipped work): bundle audit (0047),
  fetch-waterfall pass (0076/0043), API cache headers (covered by ISR, 0044).
  The remaining real levers are infrastructure, not code: Netlify functions
  region and Railway scale-to-zero (see ADR 0076).
