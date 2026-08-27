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
   Express app with no `trust proxy` setting, so `req.ip` is the _socket_ peer.
   In production the socket peer is our hosting edge proxy (Railway), not the
   real caller. So **every anonymous request carried the same proxy IP and
   shared one global rate-limit bucket** — the per-user limits were effectively a
   single platform-wide limit. One noisy client could exhaust the bucket for
   everyone, and a distributed abuser was never bucketed per-source at all.

2. **Config drift in how throttling was registered.** `ThrottlerModule.forRoot`
   was called in _two_ feature modules (`MessagesModule` limit 30,
   `GuestModule` limit 10). `ThrottlerModule` registers globally, so there were
   two competing global registrations, and three _other_ controllers
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
any caller spoof their IP and trivially dodge the limit — _worse_ than trusting
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

## Verified

**2026-08-08 — `TRUST_PROXY_HOPS=2` confirmed correct and spoof-proof for the
live Railway topology.** Checked against production via `GET /health/ip`:

- Normal request: `x-forwarded-for` was `"<client>, <edge>"` (two hops) and
  `resolvedIp` was the real client IP. The chain is
  `client → edge → Railway edge (socket, 100.64.0.0/10) → app`, i.e. two
  proxies append to XFF, so `2` is the exact hop count.
- Spoof request (`-H 'X-Forwarded-For: 203.0.113.99'`): the injected value did
  **not** appear in the XFF the app saw and `resolvedIp` stayed the real client
  IP. The edge **replaces** any client-supplied `X-Forwarded-For` with the true
  connecting IP rather than appending to it, so a forged header cannot reach —
  let alone win — the resolution. The per-IP limit is not spoofable.

The `/health/ip` diagnostic is now gated behind `IP_DIAGNOSTIC_ENABLED`
(default off → 404); enable it temporarily to re-run this check after any change
to the edge/proxy setup (e.g. adding or removing a CDN/WAF changes the hop
count), then disable it again.

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
