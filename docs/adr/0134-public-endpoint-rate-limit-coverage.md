# 0134 — Rate-limit coverage for the public endpoint surface

## Status

Accepted

## Context

ADR 0133 fixed *how* per-IP rate limits key their client (real client IP, not
the proxy). This ADR is the follow-up **coverage audit**: with the keying
correct, which anonymous (`@Public()`) endpoints still had *no* rate limit at
all? A global `JwtAuthGuard` protects everything else, so `@Public()` routes are
the entire anonymous attack surface.

Audit result — endpoints that already carried `@Throttle` were fine (messages,
guest orders, returns self-serve, invites, enterprise enquiries). Two gaps stood
out, plus a set correctly left alone:

- **`POST /auth/request-password-reset`** — public and sends an email on every
  call. Enumeration was already handled (always 200, silent no-op for unknown
  emails — ADR 0051), but with no throttle it was an **email-bombing /
  send-quota-abuse** vector: a known address could be flooded with reset emails.
- **`GET /integrations/me`** and **`POST /integrations/contacts`** — inbound,
  authenticated by a per-account API key. Unthrottled, a valid (or, in theory,
  guessed) key could hammer them. Keys are `kudos_` + 24 random bytes (192 bits),
  so online brute-force is infeasible; the real value is capping per-account
  abuse and write amplification (each call stamps `lastUsedAt`; `/contacts`
  ingests contacts).

Correctly left unthrottled: `POST /webhooks/stripe` (Stripe **signature-verified**
and legitimately bursts/retries — throttling risks dropping real payment
events); the health probes; and the low-risk read-only catalog + OAuth-callback
routes.

## Decision

- **`request-password-reset`:** `@UseGuards(ThrottlerGuard)` + `@Throttle` at
  **5/min per IP** — ample for a real mistyped attempt, far below abuse.
- **`integrations/me` and `integrations/contacts`:** throttle keyed on the
  **API key**, not the IP, via a small `ApiKeyThrottlerGuard extends
  ThrottlerGuard` that overrides `getTracker` to use `request.apiKey.keyId`
  (falling back to IP). Registered *after* `ApiKeyGuard` so the key is resolved
  first. Per-key rather than per-IP because legitimate inbound callers (e.g.
  Zapier) share a small pool of source IPs across many customers — an IP-keyed
  limit would let one account throttle unrelated ones. Limits: `/me` 60/min,
  `/contacts` 120/min per key (generous; a backstop, not a normal-use
  constraint).

All of this is a small change because ADR 0133 centralised `ThrottlerModule`
globally — adding a throttle to any controller is now just decorators.

## Consequences

- The anonymous surface no longer has an un-throttled email-send or
  contact-ingest endpoint.
- Per-account API-key budgets are isolated from each other regardless of source
  IP.
- Tests: `test/rate-limit-coverage.e2e-spec.ts` proves the password-reset per-IP
  limit (with the send stubbed) and that two API keys get independent buckets
  from the same connection — the latter also exercises `ApiKeyThrottlerGuard`'s
  DI at runtime.
- Not changed: the Stripe webhook and health probes stay unthrottled by design;
  the catalog reads and OAuth callback were judged low-risk and left as-is (a
  light read throttle could be added later if scraping becomes a concern).
