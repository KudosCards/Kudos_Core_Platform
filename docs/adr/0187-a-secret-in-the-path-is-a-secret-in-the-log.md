# 0187 — A secret in the path is a secret in the log

## Status

Accepted — implemented. From an external code review (findings 10 and 13 of 37,
paired there as the operator-access cluster).

## Context — two ways operator access leaks

### Platform settings were mutable by any operator

ADR 0040 is explicit: _"Super admin manages the operator team and platform
settings."_ `ops` is the schema default and the role every invited operator
starts on.

Ten routes on the admin controller mutate. Six declared
`@UseGuards(PlatformAdminGuard, SuperAdminGuard)`. Four did not:

| Route                          | What an `ops` operator could do                             |
| ------------------------------ | ----------------------------------------------------------- |
| `POST billing/seat-price`      | provision a **live Stripe Price** on the production account |
| `PUT dispatch/seasonal-rules`  | rewrite the Christmas lead times for every tenant           |
| `PUT dispatch/reminder-config` | **disable the send-by-5 SLA reminder platform-wide**        |
| `PUT print/card-size`          | change the default print size for every run                 |

Reproduced with an `ops` token: **three of the four returned 200 OK.** The
fourth got past the guard and only failed on reaching Stripe.

Worse, four existing test suites created their platform admin _without a role_ —
which defaults to `ops` — so the suite was asserting that these routes work for
an operator who should have been refused. The tests encoded the bug.

### Capability tokens were written to production logs

pino redacted two headers:

```ts
redact: ["req.headers.authorization", 'req.headers["x-api-key"]'],
```

but pino-http logs `url` on every request at `info`, which is the production
level. Eight routes carry a bearer-equivalent secret as a **path segment**:

- `/rts/:token` and its four sub-routes
- `/invites/:token`, `/invites/:token/accept`
- `/guest/claim/:token`

A `redact` path cannot reach a path segment, so every one was logged in full.
Anyone with log-read access — a host log viewer, a log-shipping vendor, an
on-call engineer, or an attacker who obtains logs — could replay
`POST /invites/<token>/accept` and join a customer's organisation as `admin`,
indistinguishable in the audit trail from the real invitee. The same URLs ride
on Sentry's `request.url` and its http breadcrumbs.

## Decision

### Every mutating admin route is super-admin; every read stays open to ops

The four missing guards are added. Reads are deliberately untouched: seeing the
config is an operator's job, and narrowing them would break the ops screens for
no gain. A new test asserts that directly, so "ops can read" is a stated
property rather than an accident of what was left unguarded.

The rule is now enforced structurally. `admin-mutations-guarded.spec.ts` reads
the controller source and fails if any `@Post`/`@Put`/`@Patch`/`@Delete` is not
immediately preceded by the guard — the same approach as the cron-timezone
guard, and for the same reason: what is worth pinning is that somebody wrote it
down next to the route. A new unguarded mutation now fails CI rather than
waiting for a review.

The four test fixtures that defaulted to `ops` now say `super_admin` explicitly,
with a comment recording that they used to pass against a route that should have
refused them.

### The token is stripped from the URL before it is logged

`redactUrlTokens` replaces the token segment with `[redacted]`, keeping the route
shape so the log still says which endpoint was hit. It is wired into pino
through a `req` serializer — `redact` cannot reach a path segment — and into
Sentry through `beforeSend` and `beforeBreadcrumb`, because an error report is
another place logs end up with another set of people able to read them.

Prefixes are listed explicitly rather than matched by shape: a token has no
distinguishing format, and guessing which segments are secret is how one gets
missed. So a second spec scans every controller for a `:token` route and fails
if one is not covered by a prefix — dropping `/guest/claim/` as a mutation is
caught by that scan as well as by the direct test.

## Consequences

- An `ops` operator can no longer change platform settings, and can still read
  them.
- Tokens no longer appear in application logs or Sentry.
- Three mutations, each caught: removing one guard (2 tests, one of them the
  structural scan); returning the URL unredacted from the serializer (1 test);
  dropping a prefix (2 tests, again including the scan).
- **Rotation is still worth considering.** This stops the leak going forward; it
  does not un-log what has already been written. Existing invite and RTS tokens
  are in whatever log history is retained. Invites expire in 14 days and guest
  claims in 30, so those age out on their own — but the returns token does not
  expire at all today, which is finding 12 and the next piece of work.
