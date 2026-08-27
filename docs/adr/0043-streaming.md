# ADR 0043: Performance Phase 2 — page-level streaming (Suspense)

Status: Accepted
Date: 2026-07-27

## Context

Continuation of the performance roadmap (`docs/performance-backlog.md`), after
Phase 0 + 1 (ADR 0042). The backlog's Phase 2 was originally "stream the shell
and kill the auth→page waterfall." Investigating that showed the layout refactor
is the highest-risk change in the roadmap: the `(app)` and `(ops)` shells render
their sidebar twice (desktop + mobile drawer) and the layout's account/summary
fetch doubles as the auth gate, so converting it to Suspense slots touches the
whole app's auth path for a fairly modest win (Phase 1 already parallelised and
deduped those two calls).

We chose the **lower-risk half of Phase 2** instead: page-level streaming, which
targets where the data fetch is actually the bottleneck without touching the
shell or auth gating.

## Decision

Split the two cleanly-decomposable server-rendered pages — **dashboard** and
**orders** — so the page component is non-async and returns immediately, with the
data-dependent region behind its own `<Suspense>` boundary:

- **`/dashboard`** — the static "Get cards out the door" card paints in the first
  flush; the account greeting + stat tiles (which block on `/accounts/me` +
  `/accounts/me/summary`) stream into a Suspense boundary with a matching
  skeleton.
- **`/orders`** — the page header is static and paints immediately; only the order
  list (blocking on `/batch-orders`) streams in.

The existing per-route `loading.tsx` files stay as the outer navigation fallback;
the new inner boundaries add _partial_ rendering so static chrome is real content
immediately rather than an all-or-nothing page skeleton.

## Why only these two pages

`calendar`, `recipients`, and `batch-orders` each fetch their data and hand it
wholesale to a single client component that owns the entire view (heading,
controls, and list). There is no static chrome to render ahead of the data, so an
inner Suspense boundary there would just duplicate the existing route-level
`loading.tsx`. Splitting them would mean refactoring those client components to
load sections independently — deferred, and only worth it if profiling (Phase 0's
`Server-Timing` / `API_TIMING`) shows one of their sections is the actual cost.

## Non-decisions

- **The layout auth→page waterfall is unchanged.** The `(app)`/`(ops)` layouts
  still `await` their data before rendering children. Revisiting that (Suspense
  slots for the shell) remains a future option, explicitly deferred for its risk
  on the auth path and the mobile-drawer duplication.

## Consequences

- On dashboard/orders, static content is on screen in the first flush instead of
  behind the whole-page skeleton; the data region streams independently.
- Pure rendering-structure change: identical markup, no API or data changes, no
  new dependencies.
- Verified: web lint/typecheck/build green.
