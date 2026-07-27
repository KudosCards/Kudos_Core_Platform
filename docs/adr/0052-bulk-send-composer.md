# ADR 0052 — Bulk send: a single-page composer with inline address + editor round-trip

Status: accepted
Date: 2026-07-27

## Context

Sending cards was spread across three disconnected flows that didn't share state,
and the seams showed:

- **Bulk send** (`/send`) was a _continuation_ of the Recipients multi-select: it
  only worked when contacts arrived via `?recipients=id,id`, and had no picker of
  its own. The sidebar "Bulk send" link (no params) hit an empty state that told
  the user to _go somewhere else_ — a dead-end signpost, not a place to send from.
- To choose or **edit a design mid-bulk** you left to the Konva editor, whose only
  send CTA routed to the **guided single-send** (`/designs/[id]/send`) — which asks
  for one recipient by hand. So editing a card silently dropped the bulk recipient
  selection and re-asked "who do you want to send to?".
- A contact with **no address** showed "add one" as a link to `/recipients/[id]`
  — a full navigation _out_ of the flow, losing the selection and the chosen design.

Root cause: recipient-selection, design-editing, and address-entry lived in
separate pages with no shared context to carry a bulk send through.

## Decision

Make `/send` a **self-contained bulk-send composer** — the start-here place to
build and pay for a group send, with no ejections.

- **In-page recipient picker** (`recipient-picker.tsx`) — a searchable,
  list-filterable, paginated multi-select over the account's contacts. It owns its
  own fetching (`/recipients?search=&listId=&page=`) but not the selection; the
  composer holds the selected records (full objects, keyed by id) so a contact
  stays selected even when it scrolls off the current page/search. Contacts that
  arrive from the Recipients page (`?recipients=`) seed the selection, so that
  entry still works.
- **Inline address modal** (`components/address-modal.tsx`) — an addressless
  selected contact gets "Add address", which opens the shared `Modal`, PATCHes
  `/recipients/:id`, and flips the contact to mailable **in place**. No navigation.
  The postcode field is isolated so a postcode-lookup/autocomplete enhancement can
  slot in later (deferred — it needs a paid third-party provider + key).
- **Design edit round-trip** — "Edit / personalise" on a design opens the editor
  with `?returnTo=/send?recipients=…&design=…`. The editor honours a `returnTo`
  that starts with `/send` (guarded against open-redirect): the back link and the
  primary CTA become "back to bulk send", and it saves-then-returns to the composer
  with the recipient selection intact. Editing the design persists on the design
  (no new per-order data model — a one-off per-batch message is a possible future
  follow-up).

The payment path is unchanged: the composer still posts to `POST /batch-orders/bulk-send`
then hands off to the same Stripe checkout. This is a **presentational / flow**
change only — no API or schema change.

## Consequences

- "Bulk send" in the nav is now a genuine starting point: pick people, pick a
  design, fix addresses, pay — all on one screen.
- A mid-bulk design edit no longer loses the recipient selection.
- Adding a missing address never leaves the flow.
- Deferred: real postcode lookup/autocomplete (needs a provider decision); a
  per-batch one-off inside message that doesn't mutate the saved design.
- Verified: web lint / typecheck / build green. As a UI/flow change, the real
  proof is on a device — best checked via the deploy preview. The unchanged
  bulk-send API stays covered by its existing e2e.
