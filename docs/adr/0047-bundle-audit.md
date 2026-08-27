# ADR 0047: Performance Phase 6 — bundle audit

Status: Accepted
Date: 2026-07-27

## Context

Final phase of the performance roadmap (`docs/performance-backlog.md`): audit the
client bundle — confirm heavy client components stay code-split, and defer any
non-critical JS loaded eagerly.

The backlog named `@next/bundle-analyzer`, but the app builds with **Turbopack**
(the Next 16 default). `@next/bundle-analyzer` hooks the _webpack_ config, which a
Turbopack build never runs, so it produces no report. Turbopack's `next build`
also omits the per-route "First Load JS" table that webpack builds print. So the
audit reads the chunks Turbopack actually emitted (`.next/static/chunks`).

## Findings

The client output is **57 chunks, ~2.0 MB total** (that's every route's code
summed, not any single page's first load). The largest chunks:

| Size   | Contents                                               | Loaded                                    |
| ------ | ------------------------------------------------------ | ----------------------------------------- |
| 409 KB | React + Next runtime (`react-dom`, `next/dist`)        | first load — framework floor, unavoidable |
| 304 KB | `react-konva` / `konva` — the card editor & preview    | **lazy only** (see below)                 |
| 236 KB | `react-dom` + `@supabase/*` — the Supabase auth client | near first load — needed for auth/session |

**Heavy client components are already properly code-split.** Every `react-konva`
consumer is behind `next/dynamic(..., { ssr: false })`:

- `design-canvas.tsx` → dynamically imported in `design-editor-client.tsx`
- `card-face-preview.tsx` → dynamically imported in fulfillment, the print-run
  overlay, and bulk-send

So the 304 KB Konva chunk loads only when the editor/preview actually mounts on
those routes — never in any page's first load.

**Nothing else warrants deferring.** After Konva, first-load JS is the React/Next
runtime plus the Supabase auth client, both of which are legitimately needed. There
is no heavy, non-critical library sitting in the shared/first-load bundle.

## Decision

- **No code changes to defer JS** — the one heavy, deferrable library (Konva) is
  already lazy, and there's nothing else to move. An audit that confirms the bundle
  is healthy is a valid outcome.
- **Added a Turbopack-compatible size report** (`apps/web/scripts/analyze-bundle.mjs`,
  `pnpm analyze:bundle`) in place of the webpack-only analyzer. It lists the largest
  emitted chunks and **fails if a lazy-only library (react-konva) leaks into the
  framework chunk** — a regression guard for the code-splitting that's easy to break
  with a stray top-level import.

## Notes

- If a visual, webpack-style treemap is ever wanted, run a one-off webpack build
  with `@next/bundle-analyzer`; it's not worth carrying config that the default
  Turbopack build ignores.
- Verified: `pnpm analyze:bundle` passes (konva isolated in its own 304 KB chunk);
  web lint/typecheck/build green.
