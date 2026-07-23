# ADR 0031 — `{name}` merge tokens: personalise each card face per recipient

Status: accepted
Date: 2026-07-23

## Context

The card designer has always *documented* that a text element "may contain merge tokens such as
`Dear {name},`" and that they'd be "substituted per recipient at render time" (see `card.ts`), but
**no substitution was ever implemented**. So a bulk send of one design to a whole list produced the
same card for everyone — and if a design actually contained `{name}`, it would have printed the
literal text "{name}".

The owner asked: when bulk-sending, "each card needs to be personalised with all the names in the
selected list of recipients." This wires that up for real.

## Decision

### The merge is a shared, pure contract (`packages/shared-types`)

`applyMergeTokens(document, recipient)` returns a copy of the design with every text element's tokens
resolved; `applyMergeText` does one string; `hasMergeTokens` reports whether a design personalises.
Supported tokens (case-insensitive): `{name}` and `{firstName}` → first name, `{lastName}`,
`{fullName}`. Unknown `{tokens}` are left untouched. It lives in shared-types so the web previews,
the ops production render, and any future server/print path all use one implementation — the same
"single source of truth" reasoning as the address/postcode validators.

### Merge at render, not stored per card

The design document stays the template (with `{name}`); the merge is applied wherever a card face is
rendered for a specific recipient. Nothing personalised is persisted per `OrderRecipient`, so a
contact rename is always reflected and there's no duplicated/stale document. The `OrderRecipient`
already links design + recipient, which is all the merge needs.

### Where the personalised face is rendered

A new read-only Konva renderer, `CardFacePreview`, renders a design's front page (text with the same
word-wrapping the editor uses, images, a QR placeholder) at any width. It's used at the two points
that make personalisation real:

1. **Bulk send (`/send`)** — the customer sees a grid of the chosen design rendered **once per
   recipient with that person's name merged in**, so "all the names" are visibly personalised before
   they pay. Copy adapts when a design has no token yet (links to the editor to add one).
2. **Ops fulfilment** — a "Preview card" action on each queue row opens the personalised front (via
   the audited single-card detail endpoint), so the operator prints the card **with the right name**,
   not "{name}".

The editor's text-tool label now lists the available tokens.

## Consequences

- Bulk sends are genuinely personalised end-to-end: the sender previews every card, and the operator
  produces each with the recipient's name.
- No schema change, no new persisted state — the merge is derived on demand from data that already
  exists.
- The shared `applyMergeTokens` is the seam a future automated print-render/PDF pipeline plugs into
  without reworking any of this.
- Not in scope: a bulk "print sheet"/PDF of all personalised cards at once (ops previews one card at
  a time today), and richer tokens (occasion, custom fields). Both are additive on top of the
  contract.
