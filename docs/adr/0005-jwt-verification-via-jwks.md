# ADR 0005 — Verify Supabase JWTs via JWKS, not a shared secret

Status: accepted
Date: 2026-07-15

## Context

The Phase 1 auth guard verified Supabase-issued JWTs against a static `SUPABASE_JWT_SECRET`
(HS256, shared-secret signing). Once a real Supabase project was connected, its JWT Keys settings
showed the *current* signing key is asymmetric (ECC P-256), with the old HS256 secret only
present as a "previous key" from an already-completed rotation. A shared-secret guard cannot
verify an asymmetric-signed token at all — every real login would have been rejected with a 401.

## Decision

Verify session tokens against the project's published JWKS endpoint
(`SUPABASE_URL` + `/auth/v1/.well-known/jwks.json`) using `jose`'s `createRemoteJWKSet`, restricted
to `ES256`. No shared secret is configured or stored by the API at all.

## Alternatives considered

- **Switch the Supabase project back to legacy HS256 signing** to match the original guard —
  rejected: that's downgrading the project's security posture (a leaked shared secret lets an
  attacker forge tokens; a leaked JWKS-verification setup leaks nothing, since only public keys
  are ever fetched) purely to avoid a small code change.
- **Support both HS256 and ES256** for a smoother migration — considered, but the legacy secret
  only verifies tokens issued before the project's key rotation (which already happened before
  this ADR was written), and those tokens have since expired given typical access-token
  lifetimes. Not worth the added complexity for a window that's already closed.

## Consequences

- Key rotation (Supabase can rotate signing keys at any time) is handled transparently — `jose`
  re-fetches the JWKS as needed, keyed by `kid`. Nothing in our code tracks secret versions.
- No JWT-verification secret exists to leak, rotate, or accidentally commit.
- Tests don't need a live Supabase project or network access: `apps/api/test/util/test-jwks.ts`
  generates a real ES256 keypair once per test run and builds a local JWKS from it, and
  `create-test-app.ts` overrides the app's JWKS provider with it — so e2e tests exercise the same
  verification code path as production, just against a local key instead of a network fetch.
