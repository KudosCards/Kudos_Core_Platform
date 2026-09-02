# 0228 — The web reported the tokens the API was scrubbing

## Status

Accepted — implemented. From the follow-up review's finding 13. Extends ADR 0187
to the other half of the product.

## Context

ADR 0187 established that a URL is a place secrets get written down. The API
logs `url` on every request at `info`, and reports errors to Sentry, so
`/invites/<token>/accept` was putting a credential into the log and into a
second vendor's store. It gained `redactUrlTokens`, a `beforeSend` and a
`beforeBreadcrumb`.

The web app initialises Sentry three times — browser, Node, edge — and all three
looked like this:

```ts
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0,
});
```

No `beforeSend`, no `beforeBreadcrumb`, nothing. Every public route in this
product that takes a secret takes it in the URL, because there is no session
yet — **the URL is the credential**:

| Route                                         | Secret                   | What it buys                       |
| --------------------------------------------- | ------------------------ | ---------------------------------- |
| `/invite/<token>`                             | invite token             | joining an organisation as `admin` |
| `/rts/<token>`                                | returned-to-sender token | a recipient's postal address       |
| `/gift/claim?token=`                          | guest claim token        | the account behind a guest order   |
| `/auth/confirm?token_hash=`, `#access_token=` | Supabase one-time link   | a whole session                    |

The last row is the worst and was not in the finding: Supabase's password-reset
and magic-link flows put an exchangeable credential in the query string, and its
implicit flow puts the session itself in the **fragment** — which the browser
SDK reports, because it sends `location.href`.

**Breadcrumbs are why this is worse on the client than the server.** A Sentry
error event carries the navigation trail that led to it. An ordinary crash on
the dashboard, half an hour into a session, ships the `/invite/<token>` page the
user arrived through. The token does not need an error of its own to leak.

## Decision

**One mechanism, two route lists.** `redactUrl(url, pathPrefixes)` moves to
`@kudos/shared-types`; the API keeps `redactUrlTokens` as a thin wrapper over its
own prefixes, and the web has its own. The routes genuinely differ — the API's
`/invites/<token>/accept` is the web's `/invite/<token>` — but the algorithm does
not, and a scrubber that exists twice is a scrubber that gets improved once.

It gained two things the API's version never had, and the API now gets them too:

- **Query parameter values**, by name (`token`, `token_hash`, `code`,
  `access_token`, `refresh_token`). `code` is also the OAuth authorization code
  on the CRM callbacks.
- **Fragment values**, for the implicit flow.

**String surgery, not `new URL`.** The first version parsed with
`new URL(url, base)` and rebuilt through `URLSearchParams`. Both were wrong, and
the tests said so:

- `URLSearchParams.toString()` re-encodes, so the placeholder came out as
  `%5Bredacted%5D` — and every _other_ parameter in the URL was silently
  rewritten too. A scrubber should change exactly what it was asked to change.
- Given a base to resolve against, `new URL` accepts almost anything. The
  "return it unchanged if it isn't a URL" case never fired: `"not a url at all"`
  came back as `/not%20a%20url%20at%20all`. Breadcrumb data is not all URLs, and
  mangling what it does not recognise is worse than passing it through.

**All three inits install both hooks**, including the edge runtime — the proxy
sees every request, token-bearing routes included.

## Consequences

- No token this app can put in a URL reaches Sentry, from an event or a
  breadcrumb, on any of the three runtimes.
- The API's own scrubbing gains query and fragment coverage for free.
- Ten mutations, each caught: dropping the parameter redaction, dropping the
  fragment, dropping the path redaction, narrowing the web's prefix list so
  API-call breadcrumbs go unscrubbed, and dropping `from`/`to` from the
  breadcrumb keys.

**A structural guard sits over the wiring**, because the mutations above only
prove the scrubbers work — not that they are installed. `sentry-init-is-scrubbed`
reads the source of every file containing a `Sentry.init` and asserts both hooks
are named, and asserts there are at least three so it cannot pass by finding
none. The next runtime will be added by copying one of these files, and copying
the wrong one costs nothing until a token turns up in an error report.

## Where this came from

Filed as finding 13, and correct as filed apart from missing the Supabase
routes, which are the highest-value secrets on the list.

Worth naming what it is: ADR 0187 fixed this **in the API**, and the same defect
sat untouched in the web app for as long as there has been a web Sentry. That is
the fourth time in this round of work — after ADRs 0221, 0224, 0226 and 0227 —
that the finding was _the fix stopped at the boundary it was written at_. Here
the boundary was an entire application.
