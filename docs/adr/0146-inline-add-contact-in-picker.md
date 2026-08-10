# 0146 — Add a contact without leaving the send / event flow

## Status

Accepted — implemented. From early customer feedback (Wave 2).

## Context

A customer creating a calendar **event** (and, by the same component, composing a
**bulk send**) reported two related frictions:

- **You can't add a contact while creating an event.** The contact picker only
  lets you select people who are already in your contacts. If the person you want
  to include isn't there yet, you have to abandon the half-built event, go to
  Contacts, add them, and come back.
- **The flow dead-ends.** With no contacts yet (or when a search matches nobody),
  the picker just says _"No contacts found."_ — with no way forward from there.

Both the calendar event modal and the bulk-send composer use the **same**
`RecipientPicker`, so the gap showed up in both places.

## Decision

Add an **inline "＋ New contact"** affordance to the shared `RecipientPicker`, so
a person who isn't in the list yet can be created and selected in place — no
detour.

- A **"＋ New contact"** toggle sits next to the search box; the empty state also
  offers **"＋ Add a contact"**, so the dead-end becomes an entry point.
- The quick-add captures **first + last name only** and `POST`s to `/recipients`.
  The new contact is prepended to the list, **auto-selected**, and the name
  fields clear so several new people can be added in a row (the common
  "a class of leavers" case).
- **Address is deliberately deferred.** A card can't post without an address, but
  the send flow already has a server-authoritative **pre-send check** that flags
  missing/invalid addresses and offers an inline fix before payment (ADR 0118).
  So the quick-add stays light — "add the postal address later, before sending" —
  and the existing gate guarantees nothing ships without one.

## Alternatives considered

- **A full address form inline.** Rejected for the first pass: it makes an
  already-modal (the event pop-up) tall, and the pre-send check already collects
  the address at the right moment. Name-only keeps the loop fast; the address is
  never actually lost because checkout blocks on it.
- **Deep-link out to the Contacts "add" modal and back.** That's the very detour
  the feedback complained about; keeping the create in-place is the point.

## Consequences

- From either the calendar event modal or the bulk-send composer, you can create
  a contact and include them without leaving — the empty state is now actionable
  rather than a dead end.
- One shared-component change fixes both surfaces (and any future consumer of
  `RecipientPicker`) at once.
- No API, schema, or dependency change — the picker reuses the existing
  `POST /recipients`. Contacts created this way are `source: "manual"` like any
  other, and the pre-send address gate is unchanged.
