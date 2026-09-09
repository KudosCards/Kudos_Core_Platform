# 0235 — The build cache is not the deploy

## Status

Accepted — implemented. Arises from the Next 16.3.3 security upgrade.

## Context

Four advisories landed against our dependencies overnight, two of them
**critical**:

| Package  | Severity                                                                            | Range              |
| -------- | ----------------------------------------------------------------------------------- | ------------------ |
| `next`   | 2 × critical — unauthenticated RCE (Windows hosts; Image Optimization API via AVIF) | `>=16.0.0 <16.3.3` |
| `sharp`  | high — libheif                                                                      | `<0.35.4`          |
| `multer` | 3 × high — DoS                                                                      | `<2.3.0`           |

CI gates on `pnpm audit --prod --audit-level high`, so nothing could merge —
`main` was red for everyone. The Windows RCE does not apply to us; the AVIF one
is not obviously inapplicable, since `next.config.ts` enables image optimization
with a `remotePatterns` entry for Supabase public storage.

Bumping `next` to 16.3.3, `sharp` to `^0.35.4` and adding a `multer >=2.3.0`
override cleared the audit. Every local check passed — 711 API unit, 155 web
unit, 691 e2e across 72 suites, and a clean production build.

**Netlify then failed, on all three checks, having passed on the commit
before.** A clean A/B within one PR, and the obvious reading was that the
framework bump had broken the deploy.

That reading was wrong. The build succeeded — 517 pages generated, functions and
edge functions bundled. What failed was Netlify's **secrets scanner**:

```
Secret env var "CATALOG_REVALIDATE_SECRET"'s value detected:
  found value at line 55263 in .netlify/.next/cache/turbopack/v16.3.3-a9a1cb78/00000004.sst
```

## Decision

Omit **the build cache, and only the build cache**, from the secrets scan.

```toml
SECRETS_SCAN_OMIT_PATHS = ".next/cache/**,.netlify/.next/cache/**,…"
```

Not `SECRETS_SCAN_OMIT_KEYS`, which would stop looking for this secret
everywhere, and not `SECRETS_SCAN_ENABLED=false`, which would stop looking for
any of them. Turbopack's `.sst` files are a compiler cache: they hold module
contents, they are saved and restored between builds, and they are never served.
Everything that _is_ deployed — `server/`, `static/`, the bundled functions —
stays scanned.

That scoping makes the change **safe by construction**: a secret genuinely
reaching deployable output would still fail the build. This cannot mask a real
leak, which is the only property that makes an exception of this kind
acceptable.

## What was measured before changing anything

The temptation was to disable the scanner and move on. Instead, a build with a
sentinel value for `CATALOG_REVALIDATE_SECRET`:

| Value                                               | Where it landed                                           |
| --------------------------------------------------- | --------------------------------------------------------- |
| sentinel `CATALOG_REVALIDATE_SECRET`                | **nowhere** — not the cache, not `server/`, not `static/` |
| control `NEXT_PUBLIC_API_URL` (known build-inlined) | 7 cache files, 2 server chunks, 1 static chunk            |

The control matters more than the sentinel: without it, "no hits" is
indistinguishable from a broken search. It proves the search reads `.sst` files,
and therefore that the sentinel's absence is real.

So the secret is not inlined by the build. The scanner is a plain substring
match over build output for each secret's _value_, and what it matched is a
property of the real value's own content — something that occurs naturally in
compiled output. That is worth knowing on its own: **a bearer secret short or
generic enough to appear by chance in a build artefact is short or generic
enough to guess.** Rotating `CATALOG_REVALIDATE_SECRET` to a long random value
is a separate, sensible action, and would also stop the match.

## Consequences

- The security upgrade lands. Two critical RCEs closed.
- The deploy is scanned exactly as before everywhere it is served from.
- Turbopack's cache path is version-keyed (`v16.3.3-…`), so this was invisible
  until the version changed — the omission is version-independent and will not
  need revisiting on the next bump.

## The second override that named a floor

`sharp` was already pinned `>=0.35.3` in the root `overrides`, and drifted into
the range that became vulnerable. That is the **second time in a week**: the
`fast-uri` override said `>=3.1.5`, resolved to 4.1.2, and 4.1.2 became
vulnerable the next morning.

An override written as a floor does its job for the advisory it was written for
and then silently stops protecting anything. It looks like a pin and behaves
like a permission. All five entries in that block deserve a review for the same
shape, and it is worth deciding whether they should be exact pins with a renovate
job rather than floors.

## On diagnosis

The A/B was clean and the conclusion — "the Next bump broke the deploy" — was
wrong. Three checks flipping together on one dependency change is strong
evidence of causation and says nothing about mechanism, and I reported the
mechanism before I had it. The build log was one request away and I had already
recommended reverting a critical security fix on the strength of a guess.

Correlation identified the commit. Only the log identified the cause, and they
were not the same story.
