# ADR 0023 — Faster page-to-page navigation

Status: accepted
Date: 2026-07-22

## Context

Navigating between authenticated pages felt sluggish — a visible delay on every click before the
next page appeared. A diagnosis of the request path found three compounding causes:

1. **A network round-trip on every navigation.** The Netlify edge middleware
   (`lib/supabase/proxy.ts`) called `supabase.auth.getUser()` on every request. `getUser()` calls
   Supabase's Auth server (`/auth/v1/user`) over the network to validate the token — a blocking
   hop before the page could even start rendering, paid on *every* navigation (the middleware
   matcher runs on all non-asset requests, including client-side RSC navigations).
2. **Missing loading states.** Eight app routes (`approvals`, `wallet`, `billing`, `integrations`,
   `batch-orders`, `messages`, `start`, `get-started`) had no `loading.tsx`, so a click left the
   *previous* page frozen on screen until the new page's server fetch resolved — indistinguishable
   from a hang.
3. **A cold client router cache.** With default `staleTimes`, re-visiting a page a few seconds
   later re-hit the server every time instead of using the already-fetched result.

(The API side was already healthy: `jose`'s `createRemoteJWKSet` fetches the Supabase JWKS once and
caches it in memory, so token verification there is local, not a per-request hop.)

## Decision

**1. Middleware reads the session locally (`getSession`), not `getUser`.** `getSession()` reads the
session from the cookie and only touches the network when the access token actually needs
refreshing (using the refresh token) — on the common path (valid token) it is purely local. This
removes the per-navigation Auth-server round-trip.

This is safe because the middleware is a **UX redirect gate, not the security boundary**:
- The NestJS API cryptographically verifies every JWT against Supabase's JWKS on every call.
- The authenticated layout's `GET /accounts/me` returns 401 for a bad/expired token, and the layout
  redirects to `/login` — *before* rendering any data.

So a stale or forged cookie that slips past the edge gate renders nothing; it is rejected one hop
later with no data fetched or exposed. The edge check only saves a wasted render for the common
"no cookie at all" case. (We deliberately did **not** use `getClaims()` here — a prior attempt with
it crashed Netlify's Edge runtime; `getSession()` is the well-trodden `@supabase/ssr` call.)

**2. `loading.tsx` for every app route.** Added layout-matched skeletons (reusing
`components/skeleton.tsx`) to the eight routes that lacked one, so a navigation paints an instant
silhouette that streams while the server component fetches.

**3. Tuned the client Router Cache.** `next.config.ts` sets
`experimental.staleTimes = { dynamic: 30, static: 180 }`. Our pages are dynamically rendered
(they read the session cookie), so a 30s dynamic stale window makes back-and-forth navigation
between recently-seen pages instant. Mutations already call `router.refresh()` /
`revalidatePath`, which bust the cache, so this doesn't serve stale data after a user action.

## Alternatives considered

- **Local JWT verification in middleware (`getClaims`/manual `jose`).** Fully removes the network
  hop even on refresh, but `getClaims()` previously crashed Netlify Edge, and hand-rolling JWKS
  verification at the edge duplicates what the API already does. `getSession()` gets ~all of the
  benefit with none of that risk.
- **Dropping the middleware auth check entirely.** Rejected — the cheap cookie-presence gate still
  usefully avoids rendering the shell for signed-out visitors; it just shouldn't cost a network
  call.
- **Longer `staleTimes`.** Rejected — 30s balances snappy navigation against showing data that's
  visibly out of date on return.

## Consequences

- Every page navigation drops one blocking network round-trip; routes that lacked a skeleton now
  paint instantly; revisits inside 30s are served from the client cache.
- The security posture is unchanged: authorization is still enforced by JWKS verification on every
  API call. This is documented here so the `getSession`-in-middleware choice isn't mistaken for an
  oversight in a future review.
- Verify on the Netlify **deploy preview** that the Edge middleware still runs (no "edge function
  invocation failed") and that signed-out users are still redirected to `/login` — the one thing
  local tests can't cover.
