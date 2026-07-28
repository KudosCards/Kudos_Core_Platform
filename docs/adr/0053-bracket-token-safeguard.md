# 0053 — Card editor safeguard for `[name]` merge-token mistakes

## Status

Accepted

## Context

Cards are personalised per recipient via curly-brace merge tokens (`{name}`,
`{firstName}`, `{occasion}`, …), resolved by `applyMergeTokens` in both the
send-flow previews and the ops print render (see 0031, 0033). Designers coming
from other mail-merge tools naturally reach for **square brackets** instead —
typing `To [insert name], happy birthday…` and expecting it to personalise.

Square brackets are not tokens, so that text prints **literally** on every
card. Nothing in the editor flagged this, so the mistake was invisible until a
physical card came back reading "To [insert name]". This came up directly while
confirming that bulk send personalises recipient names.

## Decision

Detect the common square-bracket token mistakes and let the designer one-click
fix them, at the design source so both single and bulk sends are protected.

- **Detection lives in the shared merge module** (`packages/shared-types/src/merge.ts`),
  the single source of truth for tokens, next to `applyMergeTokens`. A small
  `BRACKET_TOKEN_ALIASES` table maps normalised inner phrases
  (`name`, `first name`, `last name`/`surname`, `full name`, `occasion`, `date`)
  to the correct curly token. `normaliseBracketInner` lowercases, collapses
  whitespace, and strips a leading `insert`/`the`/`recipient's`, so
  `[Insert First Name]` and `[the first name]` both resolve to `{firstName}`.
  - `findBracketTokenMistakes(text)` / `fixBracketTokens(text)` operate on a string.
  - `findDesignBracketTokenMistakes(document)` / `fixDesignBracketTokens(document)`
    operate on a whole design (deduped, text elements only, pure — never mutates).
  - Only **recognised** phrases match, so legitimate uses of `[brackets]`
    (e.g. `[note 4]`) are left untouched.

- **The editor surfaces it** (`design-editor-client.tsx`): a derived
  `bracketMistakes` list renders an amber warning banner above the page tabs
  listing each `[found] → {suggestion}` pairing, with a **"Fix all
  automatically"** button that applies `fixDesignBracketTokens` to the document.
  The banner disappears once no mistakes remain. It's advisory, not blocking —
  a designer can ignore it, and the underlying data is untouched until they act.

## Consequences

- The mistake is caught at authoring time, before an order is placed, rather
  than on a returned physical card.
- Because detection is in the shared module, the same helpers are reusable
  anywhere a design's text is inspected in future (e.g. a pre-send check).
- The alias table is deliberately small and conservative — it only auto-suggests
  where the intent is unambiguous. New phrases can be added as they surface.
