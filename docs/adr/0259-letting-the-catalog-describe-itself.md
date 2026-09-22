# 0259 — Letting the catalog describe itself

## Status

Accepted

## Context

Phase C3 of `docs/click-and-forget-plan.md`, and the thing every other phase
kept running into.

A `CardDesign` carries a category, a name, a slug, a SKU and a thumbnail, and
nothing that says **who a design suits**. So "select one of those cards based on
the receiver's profile" — the first thing asked for when click and forget was
scoped — had nothing to read. ADR 0257 shipped automatic approval with a hash
of `(recipientId, year)` picking from the customer's own pool, and said plainly
that it was a placeholder with its eyes open. This is the beginning of the
answer.

## Decision

Two nullable columns on `CardDesign`, authored in Airtable and carried by the
existing sync.

### Authored upstream, not in an ops screen

The catalog already lives in Airtable (ADR 0011), the artwork re-export pass is
happening there anyway, and the sync's field matching is already tolerant of
column renames. Building an ops screen would have added a second place for the
same fact to live and a second thing to keep in step.

So the sync gains two logical fields, aliased as loosely as the rest: `Age
Band` also answers to `Age`, `Age Group`, `Suits` and `Audience`; `Tone` to
`Style`, `Mood` and `Feel`. These columns are being added by hand to a live
table, and a sync that broke on "Age" rather than "Age Band" would be worse than
no sync at all.

Because Airtable is the **only** author, a cleared cell clearing the column is
correct rather than data loss — there is nowhere else the value could have come
from. That is the property that made a second authoring surface unattractive.

### Null is not `any`

`ageBand` is `any | child | teen | adult`, and it is nullable. **Null means
nobody has described this design yet; `any` means somebody looked and said it
suits everybody.** A selection rule has to tell silence from a claim, and it
could not if the column defaulted to `any`.

This is also why the default is not "any": the migration would then have
asserted, on behalf of 217 designs nobody had examined, that each one suits a
four-year-old and a retiree equally.

`any` is nevertheless expected to be most of the catalog. The useful fact is
"this one is specifically for a child", not an age for every card.

### Age degrades safely, which is the point

A recipient's age is unknowable whenever `birthYearKnown` is false — **every
CleanCloud contact by design** (ADR 0252), and any CRM whose birthday field
carries no year. For that cohort, which is large, an age-matched rule has
nothing to match on, and an `any` card is the only safe thing to send.

So the vocabulary is built so that the common case — unknown age, undescribed
or `any` design — is the safe one, rather than an edge case to handle.

### Tone is honest about what it is for

Nothing on a recipient says "likes funny cards", so tone matches nothing at send
time. Its near-term value is the public catalog — browsing, and category pages
like "funny birthday cards" — and, later, a subscriber saying which tones their
standing order should use. Recorded here rather than left out, because the ops
pass through 217 designs is the expensive part and doing it twice is the thing
C3 exists to avoid.

### A word we cannot place is reported, not swallowed

"Middle-aged" typed into the Age Band column stores null exactly like an empty
cell. The difference between the two is whether anybody ever finds out, so the
sync summary carries both halves:

- `attributes.undescribed / total` — the ops pass's own progress bar, the number
  that has to reach zero before a selection rule can read anything better than a
  hash.
- `attributes.unknownValues` — every value somebody typed that did not map,
  named with the card it was on.

The parser is tolerant on the way in ("Kids" is `child`, "Humour" is `funny`)
because these cells are filled in by hand, and refuses to guess at anything
else, because a guess here picks the card a real person receives.

## Consequences

- The ops pass now has somewhere to put its answers, and a progress bar. Until
  it runs, every design reads as undescribed and automatic approval keeps
  picking by hash — unchanged behaviour, not a regression.
- Nothing reads the columns yet. The rule that uses them is C5, which also still
  needs the open question from ADR 0256 settled: where a pooled message goes on
  the card.
- Filtering the public catalog by tone is a follow-up, not part of this.
- `CardAgeBand` and `CardTone` are Prisma enums with zod twins, so they pair
  under `prisma-zod-enum-parity` rather than joining the exemption list.
