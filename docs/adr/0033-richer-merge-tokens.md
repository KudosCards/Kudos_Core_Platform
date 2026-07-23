# ADR 0033 — Richer merge tokens: occasion context and recipient custom fields

Status: accepted
Date: 2026-07-23

## Context

ADR 0031 introduced name merge tokens (`{name}`, `{firstName}`, `{lastName}`, `{fullName}`) so one
design sent to a list produces a personalised card per person. That covered the name only. The next
ask was to let a card also say **what the occasion is** ("Congratulations on your {occasion}", "on
{occasionDate}") and to pull in **arbitrary per-recipient details** a centre already tracks — a
child's teacher, house, class — as tokens like `{teacher}`.

## Decision

### One context object, not just a name

`applyMergeTokens`/`applyMergeText` now take a `MergeContext` (shared-types `merge.ts`) instead of a
bare `{ firstName, lastName }`:

```ts
interface MergeContext {
  firstName: string;
  lastName: string;
  occasion?: string | null;      // resolves {occasion}
  occasionDate?: Date | string | null; // resolves {occasionDate} / {date}
  customFields?: Record<string, string> | null; // each key resolves {key}
}
```

`MergeRecipient` is kept as an alias so every existing caller that passes a `{ firstName, lastName }`
(the whole `Recipient` shape included) still compiles unchanged — the new fields are all optional.

Resolution rules (`tokenValue`):
- Built-ins win over custom fields, so a stray custom field named `firstName` can't shadow the name.
- `{occasionDate}`/`{date}` render as a short, locale-stable `"25 Jul 2026"` (en-GB, UTC) — UTC so a
  date-only occasion doesn't slip a day across timezones.
- Occasion tokens resolve **only where an occasion is in context**. Unknown tokens — and occasion
  tokens with no occasion — are left as literal `{braces}`, never blanked, so a missing value is
  visible rather than silently empty.
- Custom-field keys match case-insensitively (`{TEACHER}` == `{teacher}`).

`hasMergeTokens` still probes for **name** tokens only — those are the universally-available ones, so
they're what drives the "personalised per recipient" UI hint. Occasion/custom-field tokens depend on
context that isn't known at design time.

### Where each token resolves

- **Name** — everywhere a card is rendered (send previews, ops preview, print run).
- **Occasion / occasionDate** — anywhere the card is tied to an occasion: the ops single-card
  preview and the bulk print run both now select `occasion { type, title, occasionDate }` and build
  the label (**a custom `title` wins, else the type title-cased**). The customer-side bulk *send*
  preview doesn't attach an occasion yet, so those tokens stay literal there — by design.
- **Custom fields** — read live off `Recipient.customFields` wherever the recipient is loaded.

### Schema — `Recipient.customFields`

New nullable `custom_fields JSONB` column (migration `20260723140000_recipient_custom_fields`), a
plain string→string map. Create/update DTOs accept it (`@IsObject`); the service's existing
`create`/`updateMany({ data: dto })` pass it straight through. `PATCH` replaces the whole map (the UI
sends the full set each save), consistent with it being a single JSON value rather than per-key
columns.

### Web

- **Recipient detail** gains a "Card fields" editor — add/edit/remove key→value rows, saved as one
  map — with inline help that a field named `teacher` becomes `{teacher}`.
- **Editor token hint** now lists `{occasion}`, `{occasionDate}`, and "any custom field as
  `{fieldName}`" alongside the name tokens.
- **Ops previews** (single-card + print run) pass the occasion label/date and the recipient's custom
  fields into the merge context, so the printed sheet matches what will actually be produced.

## Alternatives considered

- **Per-key custom-field columns** — type-safe but rigid; every new field a centre wants would need a
  migration. A JSON map keeps it self-service, and these values are display-only tokens, never
  queried or joined on.
- **A fixed occasion-token vocabulary baked into each design** — rejected; resolving from the live
  occasion means the same design works for a birthday and a graduation without edits.

## Consequences

- Designs can now speak to the occasion and to details a centre already holds, not just the name.
- The substitution stays one pure function shared by web and API — the printed card provably matches
  every preview.
- A missing occasion or unknown field renders as visible `{braces}`, not a blank, so mistakes are
  caught in preview rather than posted.
- Custom fields are free-form text a customer controls; they're display-only merge values (never
  executed or used in queries), and the same recipient-PII audit trail already covers reads of the
  recipient they live on.
