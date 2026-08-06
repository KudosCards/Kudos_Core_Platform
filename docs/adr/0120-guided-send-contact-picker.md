# 0120 — Address-book contact picker in the guided "Send a card" flow

## Status

Accepted

## Context

The guided send flow (`/designs/[id]/send`, ADR 0018) asked the buyer to type
the recipient's name and full postal address every time — and on submit,
`quickSend` **always created a brand-new `Recipient`**. For an account that
already has a CRM full of contacts (with addresses on file), that meant:

- re-typing an address that's already stored, and
- a **duplicate contact** created on every send to someone already in the book.

There was no way to send to an *existing* contact from this screen, even though
`GET /recipients?search=` (name match, returns the stored address) already
exists and the checkout/bulk-send flows already reuse stored contacts.

## Decision

The guided send screen gets an **address-book picker**, and `quickSend` learns
three ways to resolve "who is this for":

1. **Existing contact** — a debounced typeahead against `GET /recipients?search=`
   lets the buyer pick a stored contact; its address pre-fills the (still
   editable) form. The request sends `recipientId`, and `quickSend` **reuses**
   that recipient — no new row, so no duplicate and no recipient-cap hit. The
   form's address is used for *this order line* only; the stored contact is not
   mutated (editing an existing contact stays a deliberate, separate action).

2. **New contact, saved** (default) — no `recipientId`; `saveToContacts` defaults
   to true, so the contact is created through the normal audited, cap-checked
   `RecipientsService.create`, exactly as before. A "Save to my contacts"
   checkbox (ticked by default) makes this explicit and grows the address book.

3. **New contact, one-off** — `saveToContacts: false` creates the recipient via
   a new `RecipientsService.createOneOff`: `status: "archived"`, `source:
   "one_off"`. It satisfies the order's recipient FK but stays out of the
   contacts list and — being non-`active` — out of the plan's recipient cap
   (which counts only active contacts). No dedupe/cap check, no eager birthday
   occasion: it's a send target, not a managed contact.

`QuickSendDto` / `quickSendInputSchema` gain optional `recipientId` and
`saveToContacts`. The name/address fields stay required — they always carry the
shipping details for the order line, whether typed or pre-filled from a pick.

## Consequences

- Sending to someone already in the CRM is now one search-and-click, with the
  address filled in — no re-typing, and no duplicate contact.
- Adding a new person still, by default, saves them to the address book (best
  for a subscription CRM), with an easy opt-out for genuine one-offs.
- One-off sends leave a hidden `archived`/`one_off` recipient row. It's excluded
  from the contacts list and the cap; it exists only to anchor the order and its
  fulfilment record. (A future cleanup could reap orphaned one-offs, but they're
  cheap and already invisible.)
- No schema change: the picker reuses the existing search endpoint, and the
  one-off uses the existing `status`/`source` columns.
