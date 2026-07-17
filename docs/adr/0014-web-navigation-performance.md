# ADR 0014 — Web navigation performance: local JWT validation + streaming skeletons

Status: accepted
Date: 2026-07-17

## Context

The authenticated app shell felt slow and unresponsive when clicking between pages. Two
independent causes, both on the critical path of *every* navigation:

1. **The proxy middleware (`src/proxy.ts` → `updateSession`) called `supabase.auth.getUser()`
   on every request.** `getUser()` sends a network request to the Supabase Auth server to
   validate the access token. Next.js runs middleware for every navigation and every RSC
   prefetch (the matcher covers all non-asset paths), so each page change paid a full round-trip
   to Supabase *before* the destination page even began fetching its own data.

2. **There were no `loading.tsx` boundaries anywhere.** Every app page is a dynamic Server
   Component that awaits an API round-trip to Railway. With no loading boundary, a click produced
   no visual change at all until that fetch resolved — the previous page stayed frozen on screen,
   which reads as "the app is stuck."

## Decision

**1. Validate the JWT locally with `getClaims()` instead of `getUser()`.**
The Supabase project uses asymmetric (ES256) signing keys — the same JWKS the API verifies
against. With asymmetric keys, `getClaims()` verifies the token locally via the WebCrypto API
against a cached JWKS, with no per-request network round-trip. It still refreshes a near-expiry
session first (the refreshed cookie is captured by the existing `setAll` handler), and it falls
back to a network validation only if the project were ever switched to a symmetric secret — so it
is never slower than `getUser()` and much faster in the common case.

This does not weaken security: `getClaims()` cryptographically verifies the signature (stronger
than `getSession()`, which does not), and real authorization is enforced server-side by the API's
own JWKS verification regardless. The middleware's job is only to gate navigation and keep the
session cookie fresh.

**2. Add streaming `loading.tsx` skeletons.**
A shared `(app)/loading.tsx` covers every app route, with layout-matched skeletons for the
heaviest/most-visited routes (dashboard, recipients, calendar, orders, designs). Because the
sidebar layout persists across client navigation, these fill only the main content area — a click
now paints an instant skeleton while the destination's data streams in. As a bonus, `<Link>`
prefetch can now cache each route up to its loading boundary, so prefetched routes appear
near-instantly. Skeletons are composed from a single `components/skeleton.tsx` primitive to keep
them consistent and cheap to maintain.

## Consequences

- Every navigation drops one Supabase Auth round-trip and gains immediate visual feedback.
- No API, schema, or contract changes; the auth model is unchanged (still JWKS/ES256, still
  enforced server-side).
- Future data-heavy pages should ship a `loading.tsx` alongside `page.tsx`; the generic
  `(app)/loading.tsx` is the automatic fallback if they don't.
