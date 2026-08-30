# 0181 — One lock, not two doors, on the message body

## Status

Accepted — implemented. From an external code review of the message-page paths
(finding 4 of 37).

## Context

`MessagePage.message` is written by an account member and rendered as HTML on a
**public, unauthenticated** page — the QR target printed on a posted card —
using `dangerouslySetInnerHTML`. ADR 0132 §5 recognised that and put a sanitiser
in front of it: `sanitizeMessageHtml`, a tight allowlist with **no** permitted
attributes, so no `style`, no `href`, no event handlers.

Two routes write that column:

| Route                      | Service                                         | Sanitised |
| -------------------------- | ----------------------------------------------- | --------- |
| `PATCH /message-pages/:id` | `MessagePagesService.update` → `cleanMessage()` | yes       |
| `PATCH /messages/:id`      | `MessagesService.update`                        | **no**    |

The second wrote `dto.message` straight through, guarded only by `@IsString()`
and `@Length(0, 2000)`. And the public read returned it verbatim:

```ts
return { …, message: page.message };
```

Two doors, one lock. `MessagePageView`'s own docstring states the invariant the
unsanitised door breaks — _"on the public page it is the API's server-sanitised
HTML"_. That is the third place in this review where a comment describes the
correct behaviour and the code a few lines away does something else.

### What the threat actually is

Worth stating precisely, because the review's summary is easy to misread. `PATCH
/messages/:id` is **not** public — it sits behind `JwtAuthGuard` +
`MembershipGuard`. The `@Public` decorators on that controller are on the _read_
side (`GET /messages/:slug`, the reply endpoint, the CTA redirect).

So the writer is an authenticated member of some account — any role, including
`staff`, and including a guest-claimed account, which anyone can obtain by
buying a single card. The **audience** is what makes it serious: not the author,
not their colleagues, but every stranger who scans a printed card. It is stored
XSS against third parties, executing on a `kudoscards` origin.

### What actually executes

Verified in a real browser rather than assumed, and the result is worth
recording because it inverts the usual intuition:

| Payload                                    | Executed? |
| ------------------------------------------ | --------- |
| `<script>window.__pwned = 1</script>`      | **no**    |
| `<img src=x onerror="window.__pwned = 1">` | **yes**   |

React's `dangerouslySetInnerHTML` sets `innerHTML`, and HTML parsed that way
does not run `<script>` elements. Anyone probing this page with the classic
`<script>alert(1)</script>` would have concluded it was safe. The event-handler
attribute is the vector that fires — which is exactly why the sanitiser's
`allowedAttributes: {}` matters more than its tag list.

## Decision

### One lock

`cleanMessageHtml` moves out of `MessagePagesService` and into
`common/sanitize-message-html.ts`, where both write paths use it. The bug was
duplication, so the fix removes the duplicate rather than adding a second copy
of the guard.

### Cleaned on the way out as well as in

The write-side fix cannot reach a row already written by the unsanitised path,
and no migration can: sanitising is not expressible in SQL. So `viewBySlug` —
the only place this HTML is ever executed — cleans too. `sanitizeMessageHtml` is
idempotent, so a row cleaned at write time passes through unchanged.

### A Content-Security-Policy on `/r/`, and only `/r/`

Defence in depth for the case where both of the above are wrong. A nonce-based
policy whose `script-src` carries no `'unsafe-inline'`, set in `proxy.ts` for
`/r/` paths only.

Scoped deliberately. The designer, the Stripe redirects and the ops screens each
have their own script and frame needs, and a policy loose enough to cover all of
them would not be worth having on the one page that renders authored HTML to
strangers. Widening it is a separate exercise with its own testing.

`style-src` keeps `'unsafe-inline'`: Tailwind and Next both emit style
attributes, inline CSS cannot execute script, and refusing it would break the
page without adding safety. Keeping it permissive is what allows `script-src` to
stay strict.

The session refresh is skipped on `/r/`. It is already a public path, and its
visitor is by construction an anonymous person who scanned a printed card, so
there is no session to keep warm.

## Consequences

- Verified end to end in a real browser, in both directions. With the policy:
  the injected handler is refused, the message still renders, all 13 script tags
  carry the nonce, Next hydrates and the reply form works. With the policy
  patched out and the app rebuilt: `window.__pwned` is set — the payload runs.
  The control is what makes the first result mean anything.
- Three API e2e tests cover write-side stripping, the public read of a row
  written before the fix, and the allowlisted formatting an author may still
  use. Five unit tests pin the policy's properties so it cannot quietly loosen.
- **Not addressed here.** There is no CSP anywhere else in the web app. That is
  now a conscious gap rather than an oversight, and closing it means working
  through the designer's canvas, Stripe, Sentry and the embed hosts one surface
  at a time.
