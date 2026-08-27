# 0076 — App-shell performance: lighten every navigation

## Status

Accepted

## Context

Members reported page-to-page navigation feeling slow versus competitors. A
trace of the request path (see the site-speed review) found the cost was
concentrated in the **authenticated app shell**, which every navigation pays
before the page even renders:

1. Middleware (`proxy.ts`) — already optimised: `getSession()` (local), not
   `getUser()` (network). ✅ (ADR 0023)
2. **`(app)/layout.tsx`** — fired **two** blocking API calls: `/accounts/me`
   **and** `/accounts/me/summary`. The summary runs **~10 parallel Postgres
   count/aggregate queries**, but the shell only renders **three** of them (the
   approvals badge, the basket count, the wallet chip). So visiting _any_ page
   ran the full home-screen aggregation just for three sidebar numbers.
3. The page's own fetches.

All server fetches are `cache: "no-store"` and travel Netlify → Railway →
Supabase. Hosting is region-aligned (all UK), so cross-region latency is _not_
the cause — the cost is redundant work + round-trips on every navigation, plus
Railway cold-starts (tracked separately).

Already-good foundations left untouched: `getSession` middleware, React
`cache()` on the session read, router `staleTimes` cache, Konva editor
lazy-loaded, public `/cards` on ISR, `next/image` optimisation, DB indexes.

## Decision

Three changes, all safe and behaviour-preserving.

**1. A tiny per-navigation endpoint.** New `GET /accounts/me/nav-badges` returns
just `{ pendingApprovals, unfinishedOrders, walletBalanceMinor }` — **three**
counts in one round-trip. The layout uses it instead of the ten-count
`/accounts/me/summary` (which stays, unchanged, for the dashboard that actually
needs all of it). Every navigation's shell query cost drops ~70%.

**2. Cache the low-churn account read, per-user.** `cachedServerApiFetch`
wraps the fetch in `unstable_cache` keyed by **`[path, userId]`** (so one account
can never see another's data) with a short TTL, used only for `/accounts/me`
(name + plan, which change rarely). Once warm, the account is served from the
Next data cache — no Railway/Postgres hop on the critical path.

The nav badges are **deliberately not cached**: they change on user actions and
must stay fresh. Our mutations go through the Nest API, not a Next Server Action,
so `router.refresh()` / `revalidateTag` can't bust a Next data-cache entry —
caching the badges would show a stale count for up to the TTL after an action.
Keeping them uncached-but-cheap (change 1) is the correct trade.

**3. Instant-load skeletons on the remaining data pages.** Added `loading.tsx`
to `/send`, `/settings`, `/team`, `/orders/[id]`, `/recipients/[id]` (the
higher-traffic pages that lacked one). The App Router now paints the shell +
a skeleton immediately on navigation while the server component fetches, so
navigation _feels_ instant. Most list pages already had these.

## Consequences

- Every authenticated navigation does markedly less work: three counts instead
  of ten for the badges, and (once warm) zero DB round-trips for the account.
- Navigation feels immediate on more pages (skeleton on first paint).
- The badges can be at most one navigation stale in the rare race where a
  mutation lands between fetch and paint — acceptable for cosmetic counters, and
  no worse than before.
- `unstable_cache` is per-user-keyed; a review checklist item: **never** pass
  user-specific data through it without the user id in the key.
- Not addressed here (tracked separately): Railway cold-starts (keep a warm
  instance) and a client-bundle pass — the next levers once these land.
- Tests: `accounts` e2e gains a nav-badges case (auth required; zeroed for a new
  account; reflects a pending-approval occasion). Full API e2e green (279).
