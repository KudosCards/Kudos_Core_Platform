# 0119 — Checkout address pre-fill & retained campaign classification

## Status

Accepted

## Context

Two pieces of pre-launch user feedback turned out to be live bugs:

1. **Duplicate address prompt at checkout.** A contact already carries a postal
   address on their record, and occasions are approved against that contact. But
   the `/batch-orders` checkout page started every selected line with **blank**
   address fields and forced the buyer to re-type an address that was already on
   file. The occasions feed (`GET /occasions`) didn't carry the recipient's
   address, so the page had nothing to pre-fill from.

2. **A birthday send lost its birthday classification and looked overdue.**
   Sending via the birthday segment (remove all but one contact, pay, send)
   created a `bespoke_campaign` occasion dated **today**. Two root causes:
   - the bulk-send never inherited the matched natural (birthday) occasion's
     `type`/`occasionDate` — it only *superseded* it (ADR 0107), so the send
     record was bespoke, not birthday;
   - the send occasion's `occasionDate` was `now`, and `computeDispatchDate(now)`
     returns ~5 working days in the **past**, so its fulfilment `dueDate` landed
     last week and the ops queue flagged it overdue — for a card being produced
     today. This affected *every* immediate one-off send (bulk and guided), not
     just birthdays.

## Decision

1. **Pre-fill the checkout address from the contact record.** The occasion's
   nested `recipient` now carries its stored address (`addressLine1/2`, city,
   postcode); the checkout line is pre-filled from it (still editable) instead of
   starting blank. An address already on file is never re-keyed.

2. **A one-off send inherits the campaign's classification, and ships "today".**
   When a bulk-send supersedes a natural occasion (e.g. a birthday from the
   birthday segment), the created send occasion **inherits that occasion's
   `type`** — so it stays a *birthday*, not a bespoke event. It keeps the send
   moment as its own `occasionDate`, deliberately: the DB enforces a unique
   `(recipientId, type, occasionDate)`, so there can only ever be one birthday
   occasion per person per date, and the superseded natural one already holds the
   birthday's own date — a second on that date is impossible (and a full timestamp
   keeps repeat same-day sends collision-free too). Because an `asap` one-off send
   is **paid and produced now**, its `dispatchDate` is set to **today** (not
   back-computed from the occasion date), so the ops queue reads it as due now,
   never overdue. The same "dispatch today" rule is applied to the guided single
   send (`quickSend`), which had the identical back-dating bug.

   (Putting the send's calendar event *on the birthday itself* would need a
   larger rework — reusing the natural occasion as the send record rather than
   creating a superseding one-off — because of that uniqueness rule; deferred.)

## Consequences

- The two most-reported friction points in the ordering flow are gone: no
  address re-entry, and a birthday card sent via the segment stays a birthday and
  isn't wrongly flagged overdue.
- `computeDispatchDate` is now used only for genuinely *scheduled* occasions
  (the auto/birthday scheduler), where back-computing from a future date is
  correct. Immediate one-off sends date their dispatch to the day they're made.
- The occasion `recipient` shape now optionally carries the address; endpoints
  that don't select it still parse (the field is optional).
