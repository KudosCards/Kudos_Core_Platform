# 0081 — CORS allow-list + strict URL env validation

## Status

Accepted

## Context

During the custom-domain cutover, the whole `kudos-cards.co.uk` site couldn't
talk to the API — admin login, password reset, everything failed. Two compounding
weaknesses turned a one-character typo into a total outage:

1. **Single-origin CORS.** The API allowed exactly one browser origin:
   `config.get("WEB_APP_URL")`. Any mismatch blocks *every* browser→API call at
   once — there's no graceful degradation.
2. **Loose URL validation.** `WEB_APP_URL` was set to `ttps://kudos-cards.co.uk`
   (missing the `h`). `z.string().url()` accepted it, because `new URL("ttps://…")`
   parses — it treats `ttps:` as a valid, if nonsensical, scheme. So the API
   booted happily with a CORS origin that no real request ever matches, silently
   locking the real domain out of the backend. A silent failure, the worst kind.

## Decision

Two small, tested changes so this class of failure can't recur.

**1. Strict http(s) URL validation.** A shared `httpUrl` zod schema requires the
parsed protocol to be `http:` or `https:`. `WEB_APP_URL` now uses it, so a
scheme typo (`ttps://…`) **fails loudly at boot** with a clear message instead of
booting a dead CORS origin. (Applied to `WEB_APP_URL` specifically — other URL
envs like `DATABASE_URL` use non-http schemes and are left on `url()`.)

**2. Configurable CORS allow-list.** CORS `origin` is now built from a list —
`WEB_APP_URL` plus two new optional envs:
- `CORS_ALLOWED_ORIGINS`: comma-separated extra exact origins (e.g. the `www`
  host, a staging domain).
- `CORS_ALLOWED_ORIGIN_SUFFIXES`: comma-separated origin *suffixes* for dynamic
  hosts like Netlify deploy previews (e.g. `--kudos-cards.netlify.app`).

A small pure module (`config/cors.ts`) does the matching: exact match
(slash-insensitive) or `endsWith` a configured suffix; requests with no `Origin`
header (same-origin, server-to-server, curl) are allowed; a disallowed origin is
refused by omitting the `Access-Control-Allow-Origin` header (callback `false`),
never by throwing. Both new envs are optional and default to empty, so behaviour
is unchanged for anyone who doesn't set them (just `WEB_APP_URL`, now as a
one-element list).

## Consequences

- A wrong or typo'd origin value degrades gracefully (that one origin is refused)
  instead of blacking out the entire app; and a scheme typo can't boot at all.
- Multiple front-end origins (custom domain + `www` + previews) can be trusted
  without code changes — just env.
- `WEB_APP_URL` stays the single canonical value for building links (Stripe
  redirects, auth emails); the allow-list is additive and CORS-only.
- Tests: `config/cors.spec.ts` (exact/suffix/deny/no-origin, and that a suffix
  isn't treated as a substring); `env.schema.spec.ts` gains a case proving a
  `ttps://` `WEB_APP_URL` is rejected. Runbook §1b + env table updated.
- Not done: reflecting arbitrary origins or a broad `*.netlify.app` match — the
  suffix must be specific (`--<site>.netlify.app`) so it can't trust unrelated
  Netlify sites.
