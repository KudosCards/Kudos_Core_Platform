# 0061 — "Insert merge field" dropdown in the card editor

## Status

Accepted

## Context

Cards are personalised per recipient with curly-brace merge tokens (`{firstName}`,
`{occasion}`, …), resolved by `applyMergeTokens` at send/print time (see 0031,
0033). The card editor only *documented* the tokens — a paragraph of help text
above the text box listing `{name}`, `{firstName}`, `{lastName}`, and so on — and
left the designer to type the exact token by hand. That's undiscoverable and
error-prone: a typo (`{firstname }`, `{Frist Name}`) prints literally, and 0053
already had to add a safety net for the related square-bracket mistake.

User feedback asked for the obvious fix: a **"Insert Merge Field ▾"** dropdown
that inserts the correct token at the cursor, so nobody has to remember the
syntax.

## Decision

Add a small **"Insert merge field"** `<select>` to the text-element panel that
drops the chosen token into the textarea at the caret.

- **The field list lives in the shared merge module**
  (`packages/shared-types/src/merge.ts`) as `MERGE_FIELDS`: an ordered list of
  `{ label, token }` pairs (`First name → {firstName}`, `Last name`,
  `Full name`, `Occasion`, `Occasion date`). It sits next to `MERGE_TOKENS` and
  `applyMergeText`, the single source of truth, so the menu can never drift from
  what actually resolves at send time. Unit tests assert every field's token is
  a recognised built-in and genuinely resolves (isn't left as a literal).
- **Insertion is caret-aware** (`design-editor-client.tsx`): the text box has a
  ref, so a pick splices the token into `text` at `selectionStart…selectionEnd`
  (replacing any selection), then a layout effect restores the caret just after
  the inserted token so typing continues in place. If the box isn't focused, the
  token appends at the end.
- **The `<select>` is a menu, not a value**: it stays pinned to a
  "Insert merge field…" placeholder (`value=""`) and fires on each pick, so the
  same field can be inserted repeatedly.
- **Custom fields stay type-it-yourself**: recipient custom fields also work as
  `{fieldName}` tokens but aren't known at design time, so the menu lists only
  the built-ins and a short tip covers the custom case. The old wall-of-tokens
  help text is replaced by the dropdown plus that one-line tip.

## Consequences

- Personalisation is discoverable — a designer who has never seen the token
  syntax can still personalise a card correctly.
- Fewer literal-token mistakes reach a printed card; this complements the
  square-bracket safety net from 0053 rather than replacing it.
- `MERGE_FIELDS` is reusable anywhere else a merge-field picker is wanted later
  (e.g. the bulk-send composer), with the same guarantee that the offered fields
  are real tokens.
