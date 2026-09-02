# 0224 — The comment named one sink; there were three

## Status

Accepted — implemented. Follow-up to ADR 0181 (finding #4, stored XSS via
`PATCH /messages/:id`).

## Context

ADR 0181 sealed the write path — `cleanMessageHtml` on create and update — and
then cleaned on the way out as well, because a row written before the seal is
still in the table and no migration can fix it (sanitising HTML is not
expressible in SQL). That out-bound clean went on the public recipient read, and
the code carried this justification:

```ts
// Cleaned on the way out as well as in. The write-side fix cannot reach a
// row already written by the unsanitised path, and there is no migration
// that can (sanitising is not expressible in SQL) — so the public read,
// which is the only place this HTML is ever executed, does it too.
```

The clause after the dash was not a fact. It was the reasoning, written as
though it had been checked. Three functions read `message` off the row:

| Read                               | Where it lands                  | Was it cleaned? |
| ---------------------------------- | ------------------------------- | --------------- |
| `MessagesService` public read      | `/r/<slug>` → `MessagePageView` | yes             |
| `toDetail` (`MessagePagesService`) | the authenticated builder       | **no**          |
| `toAccountMessagePage`             | a `<textarea>` value            | not needed      |

`toDetail` feeds `/message-pages/[id]`, and the builder puts that string through
**both** raw-HTML sinks in the app: `MessagePageView`'s
`dangerouslySetInnerHTML` for the live preview, and `RichTextEditor` seeding
`ref.current.innerHTML` on mount. Same column, same two components, one origin
over.

And the mitigating layer is not there either. The nonce CSP is applied in
`proxy.ts` under `if (request.nextUrl.pathname.startsWith("/r/"))`, and
`next.config.ts` sets no headers — deliberately, per ADR 0181, because a policy
loose enough for the designer and the Stripe redirects would not have been worth
having on `/r/`. So the public page, the one that got the clean, is also the one
page with defence in depth. The authenticated builder had neither.

The exposure is self-inflicted rather than cross-account: message pages are
scoped to the account, so a legacy row runs when its own author opens it to
edit, on an origin holding their session. It is still the finding the write-side
fix was supposed to have closed, surviving in the one place a person is most
likely to go — you open the builder _because_ you want to change the message.

`toAccountMessagePage` is left alone on purpose. Its value is a `<textarea>`
value, which React escapes, and anything typed back comes through the sanitised
write path. Cleaning it would be harmless but would say, wrongly, that a
textarea is a sink.

## Decision

`toDetail` cleans, for the same reason the public read does, with the reason
stated as the fact it is:

```ts
message: cleanMessageHtml(page.message),
```

`cleanMessageHtml` is idempotent, so a row cleaned at write time passes through
unchanged; the cost is one sanitiser pass per builder load.

The public read's comment is corrected. It now says _every read that can reach a
raw-HTML sink does it too_, and records that the sentence it replaces is the one
on whose strength the builder's read was left raw.

## Consequences

- A legacy row cannot execute in the builder, in the preview, or in the editor.
- Three e2e tests, written failing first, write the payload straight to the row
  with `prisma.messagePage.update` — the API would clean it on the way in, so a
  test that goes through the API proves nothing about the read. They cover an
  inline handler, a `javascript:` href, and ordinary formatting surviving
  intact. Reverting the call makes the first two fail.
- No backfill. 95 message pages exist, 3 have a message, 0 contain anything the
  sanitiser would strip, 0 predate the write-side fix. The out-bound clean is
  the guard for a row that does not currently exist, which is the right shape
  for it — it costs one pass and does not depend on having got the count right.

## Where this came from

Not from the follow-up review; from applying the review's closing note to work
already marked done. _The fix was applied where the finding pointed, and the
same defect survives one call site over._ ADR 0221 found the same shape in the
occasion realign, ADR 0222 one model over from that, and ADR 0223 in a mirror
image the suggested fix did not cover.

The generalisable part is narrower than "check the other call sites", because
here the other call site was named in a comment as not existing. **A comment
that asserts a global fact — "the only place", "always", "never" — is a claim
about code that was not read.** Enumerating the reads takes a grep. Writing the
sentence instead took a week off the clock and left the sink a person uses most
uncovered.
