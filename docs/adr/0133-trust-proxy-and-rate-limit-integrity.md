# 0133 — Trust-proxy + public rate-limit integrity

## Status

Accepted

## Context

Every genuinely public, anonymous endpoint in the API is protected by
`@nestjs/throttler` with a per-IP limit — the public message-page read
(`GET /messages/:slug`, 30/min), the recipient reply (`POST /messages/:slug/replies`,
5/min), the CTA-click redirect, the guest-order routes (10–20/min), the
returns-self-serve, team-invite, and enterprise-enquiry endpoints. The
throttler's default tracker keys on the request IP.

Two problems made those limits far weaker than they looked:

1. **The IP was the proxy's, not the client's.** `NestFactory.create` builds the
   Express app with no `trust proxy` setting, so `req.ip` is the *socket* peer.
   In production the socket peer is our hosting edge proxy (Railway), not the
   real caller. So **every anonymous request carried the same proxy IP and
   shared one global rate-limit bucket** — the per-user limits were effectively a
   single platform-wide limit. One noisy client could exhaust the bucket for
   everyone, and a distributed abuser was never bucketed per-source at all.

2. **Config drift in how throttling was registered.** `ThrottlerModule.forRoot`
   was called in *two* feature modules (`MessagesModule` limit 30,
   `GuestModule` limit 10). `ThrottlerModule` registers globally, so there were
   two competing global registrations, and three *other* controllers
   (`returns-public`, `invites`, `enterprise-public`) used
   `@UseGuards(ThrottlerGuard)` while their own modules imported the throttler
   from neither — they worked only as a side effect of whichever feature module
   happened to initialise last. Fragile and surprising.

## Decision

**1. Trust a specific number of proxy hops.** A new `TRUST_PROXY_HOPS` env var
(validated in `env.schema.ts`) is applied in `configureApp` as Express's
`trust proxy`. With it set, Express derives `req.ip` (and `req.ips`) from the
`X-Forwarded-For` chain, so the throttler keys on the real client IP.

Crucially it is an **exact hop count, never `true`**. `trust proxy = true`
tells Express to believe a fully client-supplied `X-Forwarded-For`, which lets
any caller spoof their IP and trivially dodge the limit — *worse* than trusting
nothing. A hop count `N` trusts only the `N` proxies nearest the server and
reads the client IP from the correct position. Railway's edge is a single hop,
so the default is `1`; a CDN/WAF in front of the API would make it `2`.
`TRUST_PROXY_HOPS=0` disables it (falls back to the socket IP — the exact
pre-fix behaviour) as a safe escape hatch. Applied in `configureApp`, which is
shared by production and every e2e test, so tests exercise the real pipeline.

**2. One central throttler registration.** `ThrottlerModule.forRoot` now lives
once in `AppModule`; the two per-module registrations are removed. Every
`@UseGuards(ThrottlerGuard)` route across all six controllers is backed by that
single global config, and each keeps its own per-route `@Throttle(...)` limit
(unchanged). The global entry is only a backstop.

## Consequences

- Per-IP limits are now genuinely per client. A single abusive source is
  bucketed on its own; ordinary users are unaffected by each other.
- Spoofing is not opened up: because we trust an exact hop count and not `true`,
  a caller cannot forge `X-Forwarded-For` past the trusted proxies.
- The throttler wiring is no longer an accident of module load order.
- **Verification before trusting in production.** The correct hop count depends
  on the deployment topology, and a too-permissive count is a security
  regression. Before relying on it, confirm on staging that `req.ip` resolves to
  the real client (not a `10.x`/proxy address) for a request through the real
  edge URL; if the edge turns out to be more than one hop, raise
  `TRUST_PROXY_HOPS` — no code change needed. `0` is always available to revert
  to socket-IP behaviour instantly.
- Tests: `test/rate-limit-proxy.e2e-spec.ts` drives two distinct
  `X-Forwarded-For` client IPs through the real pipeline and asserts that
  exhausting one client's allowance returns `429` while a different client is
  unaffected — a regression guard that would fail if trust-proxy were disabled
  (both clients would collapse onto the socket IP and share a bucket).

## Not done (deliberately, with a clear path)

- **Shared store for multi-instance correctness.** The throttler's default store
  is in-memory, so with more than one API instance each replica counts
  independently and the effective limit is `limit × replicas`. This is correct
  for a single instance. When the API scales horizontally, swap a shared store
  (e.g. `@nestjs/throttler-storage-redis` backed by a `REDIS_URL`) into the
  single `ThrottlerModule.forRoot` in `AppModule` — the centralisation done here
  is what makes that a one-line change.
- **Per-resource caps.** The per-IP limits do not stop many IPs from spamming a
  single card's reply endpoint. A named per-slug throttle on
  `POST /messages/:slug/replies` would add that defence and can layer on top of
  the per-IP limit without touching this change.
