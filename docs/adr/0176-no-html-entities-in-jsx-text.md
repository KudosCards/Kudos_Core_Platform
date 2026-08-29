# 0176 — No HTML entities in JSX text: they eat a space

## Status

Accepted — implemented.

## Context

JSX text is not HTML, and the difference costs a space.

When the transform meets an entity inside a text node it splits the node around
it, and each fragment is then re-trimmed with the usual JSX rule — whitespace
that touches a newline goes away. A fragment that began mid-line, right after a
`{expression}`, gets its leading space stripped as if it had started on a fresh
line. Two words print welded together.

This was found while fixing an em dash in the send-timing picker, then measured
across the whole app with a TypeScript AST walk and confirmed by rendering every
candidate. **Thirteen were live**, three of them on the public card page a
customer buys from:

| Screen                           | Printed                                      |
| -------------------------------- | -------------------------------------------- |
| `/cards/[category]/[slug]`       | `✓Personalised with each recipient's name`   |
| `/cards/[category]/[slug]`       | `✓Printed & posted for you — from £2.49`     |
| `/cards/[category]/[slug]`       | `✓Add a scan-to-watch message page`          |
| Contacts, missing-address banner | `1 contactcan't be posted to.`               |
| Pre-send check                   | `2 itemson the back won't be printed`        |
| Order detail                     | `Your wallet balance of £5covers this order` |
| Batch orders                     | `A card to Chriswas recently returned`       |
| Message pages                    | `No activity in the last 30days yet`         |
| Order detail (reschedule)        | `timed to 3different occasions`              |
| Fulfilment preview               | `Bloom— printed exactly as shown`            |
| Set plan (ops)                   | `via a activeStripe subscription`            |
| Subscription backfill (ops)      | `2weren't subscription invoices`             |
| Arrival sweep (ops)              | `0marked arrived & emailed`                  |

Nothing catches these. They lint, they typecheck, they build, and a component
test of the same screen passes, because assertions tend to match a substring on
one side of the missing space. Only reading the finished sentence reveals it,
which is exactly what nobody does to a line of copy they did not just write.

The trigger is the entity, not the punctuation: the same sentence written with
`cannot` instead of `can&apos;t` keeps its space. Measured across eleven
variants before writing any fix.

Trailing-side whitespace is unaffected — a space before a following
`{expression}` survives — so the rule is specifically about a text node that
**starts mid-line and runs on to another line**.

## Decision

**Write the character, not the entity.** `’` for an apostrophe, `“ ”` for
quotes, `&` for an ampersand. They render identically, they are what the copy
means, and they cannot be split.

All 161 entity occurrences in JSX text across 78 files were converted
mechanically, by AST rather than by regex, so attribute strings and code were
left alone. (Entities in a JSX _string attribute_ are decoded normally and are
not affected — verified by rendering.)

Two entities stay: `&lt;` and `&gt;`, because a bare `<` or `>` in JSX text has
no literal spelling. One `&lt;10 min` remains, on a single-line node where the
bug cannot occur.

**`apps/web/scripts/check-jsx-text.mjs` fails the build** on any other entity in
JSX text, and separately on `&lt;`/`&gt;` used in the space-losing shape — write
`{"<"}` there. It runs in `pnpm test` alongside the design-token checker, and
names the character to write instead.

### Why a script and not an ESLint rule

`react/no-unescaped-entities` — already on, via `eslint-config-next` — pushes the
_opposite_ way: it forbids a raw `'` or `"` in JSX text, which is what sends
people to `&apos;` in the first place. The curly `’ “ ”` this ADR asks for
satisfy both rules at once. Writing a custom ESLint rule to say the rest would
mean a plugin package for one check; the repo already has the precedent of a
build-failing script next to the linter (`check-design-tokens.mjs`, ADR 0157),
and this fits it.

## Consequences

- Thirteen corrupted sentences are fixed, including three on a public sales
  page, and the class cannot return silently.
- Apostrophes are now consistently typographic. The app was previously mixed —
  141 `&apos;` against 15 `&rsquo;` — so this settles a style question that was
  never decided, in the direction better typography already wanted.
- The guard is source-level, which is stronger than a rendering test here: it
  covers all 213 `.tsx` files rather than the four screens under test, and it
  reports the fix rather than an assertion failure. Both branches were
  mutation-tested — reintroducing `&rsquo;`, and moving `&lt;` into the risky
  shape — and each was caught.
- Copy in a non-Latin script, or anything needing a genuine `&nbsp;`, has to use
  an expression container (`{" "}`). That is the honest spelling anyway: an
  invisible character should be visible in the source.
