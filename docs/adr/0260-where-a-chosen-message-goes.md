# 0260 — Where a chosen message goes

## Status

Accepted

## Context

Phase C5 of `docs/click-and-forget-plan.md` — the last one, and the one that
makes the message pool mean something.

ADR 0256 recorded an open question and refused to guess at it:

> `buildCardDocument` seeds the inside-right text element with
> `id: "inside-message"`, but nothing reads that id back and a customer can
> rename or delete it in the editor — so it is a convention by accident, not a
> contract. C5 has to decide this properly rather than guess, because guessing
> wrong prints the wrong thing on a card that cannot be recalled.

This settles it, with evidence rather than a preference.

## Decision

### The rule, and why each step is the way round it is

1. **The seeded block, by id.** The editor's element update maps by id
   (`design-editor-client.tsx`: `elements.map((el) => el.id === updated.id ? updated : el)`),
   so `inside-message` survives every edit to the text. It dies only when
   somebody deletes that block and adds a new one — which is exactly when we
   should stop trusting it.
2. **Otherwise the only text block on the inside-right page.** A catalog design
   has exactly one or none, so this covers a design whose message block was
   replaced rather than edited.
3. **Otherwise nothing.** Two candidate blocks is a design somebody built
   deliberately, and choosing between them is a coin toss printed on a card that
   cannot be recalled.

### Except that a blank inside page is written on

The first version of this refused to add a block at all, on the grounds that two
messages stacked on one face is a defect this codebase already has machinery for
(`card-content.ts`, written after it shipped twice — once with the recipient's
message and somebody else's overlapping).

The e2e caught the cost: a design with **no** inside text got no message, and
that is not a rare case. A member's own uploaded artwork starts from a blank
document (ADR 0026), and a catalog card whose Airtable "Inside Message" is empty
gets no block either. Those designs could never have carried a message.

So the rule is narrower than "never add": never add **beside existing text**. An
empty page has nothing to stack against, and the block written there uses the
same geometry `buildCardDocument` seeds — pinned by a test against the builder,
so a card that never had a message ends up looking like one that did.

### A card with no readable slot still goes

Reported, not refused. A birthday with no card at all is the larger failure, so
the card goes carrying the design's own words — and the subscriber is told
**which cards by name** at the point they choose them, because "two of your
cards" is not something anybody can act on.

The page asks that question by running the real placement over the design and
seeing whether it landed, rather than reimplementing the rule. A second copy of
"where does a message go" would drift from the one that prints, and the drift
would show as a page promising a message that never appears.

### Chosen at approval, applied at send

The message id is stored on the occasion when the standing order approves the
card, not worked out at send. Two reasons: it can be seen before it is printed,
and a pool edited on the Tuesday cannot silently rewrite the card going out on
the Wednesday.

Its foreign key is `ON DELETE SET NULL`, deliberately unlike the design's
`RESTRICT` beside it. Rewriting a message pool is an ordinary thing to do and
must not be blocked by a card already approved; that card falls back to the
design's own words. A design going missing is a card with no artwork, which is
why that one blocks.

The substitution happens on the **card's own copy** — `documentSnapshot` — never
on the saved design, which belongs to the customer and is shared by every card
made from it.

### The design pick now reads the catalog

With ADR 0259's columns in place, the pick prefers a card whose age band matches
the recipient's, in tiers: exact band, then `any`, then undescribed, then a
different band.

Two properties of that ordering are deliberate:

- **Undescribed beats a mismatched band.** Silence is a smaller risk than a card
  somebody explicitly marked for a different age.
- **Prefer, never exclude.** A nursery whose entire pool is children's cards
  must still send to a contact whose age we do not know — and we do not know it
  for every CleanCloud contact (ADR 0252). An unmatched tier is a last resort,
  not a filter.

The message pick is salted differently from the design pick. With one seed, four
designs and four messages would only ever produce four of the sixteen pairings,
and the same person would get the same combination every year the pools happened
to match in length.

## Consequences

- "Click and forget" is complete: a subscriber chooses contacts, cards and
  messages once, and a card goes for every birthday with their own words on it.
- The "Not printed yet" notice is gone from the dashboard, replaced by a warning
  that names the cards which cannot take a message.
- `standing-orders.service.ts` joins the four files allowed to read a design's
  document, declared with its reason in `card-artwork-single-source.spec.ts`.
- Nothing about the AI half of the scoping is built. `source: "assisted"` is
  recorded on a message and nothing writes it yet; drafting messages with a
  model is a separate piece with a vendor and a data-processing agreement
  attached, and the pool it would write into now demonstrably works.
