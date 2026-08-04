# 0098 — Recipient profile: make the postal address visible and editing obvious

## Status

Accepted

## Context

Opening a recipient's profile to add their postal address was a dead end. In
read mode the page showed the header, a Return-to-sender panel, then the Events
and Card-fields sections — but the address was nowhere on screen. It only
appeared once you pressed **Edit details**, which surfaced the full edit form
(name, DOB, email, and the four address lines) in one block. So the single most
common reason to open a profile — "post a card to this person, they need an
address" — required guessing that a button labelled *Edit details* was where an
address lived. The space to type one wasn't obvious.

## Decision

Show the postal address in read mode, and make adding one a first-class action.

1. **A read-mode "Contact details" card.** Rendered whenever the editor is
   closed, placed directly under the Return-recovery panel (above the Events
   section). It leads with the postal address because that's the field that has
   to be present before a card can be posted:
   - **When an address is on file** — it's rendered as a proper multi-line
     `<address>` block inside a bordered panel, with an inline **Edit address**
     button.
   - **When it's missing** — an amber callout ("No postal address yet · Add one
     so {name} can be posted a card.") with a prominent accent **Add postal
     address** button. This is the CTA the user was missing.
   - DOB and Email follow in a small definition list, each showing "Not on file"
     when empty.

2. **The CTA opens the editor focused on the address.** Both "Add postal
   address" and "Edit address" call a new `openEditor(true)` helper that sets an
   `openedForAddress` flag and opens the existing edit form. The **Address line
   1** input carries `autoFocus={openedForAddress}`, so the cursor lands in the
   address straight away rather than at the top of the form. When opened this way
   for a recipient with no address, the form heading reads **Add postal address**
   instead of *Edit details*, matching what the user set out to do.

3. **Editing stays one obvious form.** The header **Edit details** button (and a
   new **Edit** link in the card header) open the same form via `openEditor(false)`
   — no autofocus jump, general editing. `closeEditor()` resets both flags on
   Cancel and after a successful save. The edit form itself is unchanged.

An inline `hasPostalAddress` check (address line 1 + city + postcode all
present) decides which state the card shows — the same "mailable" definition the
recipients list uses.

## Consequences

- The address is visible the moment you open a profile, and the path to add a
  missing one is a single, clearly-labelled button that drops you straight onto
  the address field — the reported friction is gone.
- No API or schema change; this is web-only, reusing the existing PATCH
  `/recipients/:id` save path and the existing edit form.
- The read-mode card and the edit form are mutually exclusive (`!editingDetails`
  vs `editingDetails`), so there's one source of truth on screen at a time and no
  duplicated address rendering to keep in sync.
