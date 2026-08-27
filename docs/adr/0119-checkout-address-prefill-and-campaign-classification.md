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
   - the bulk-send never carried the matched natural (birthday) occasion's
     `type`/`occasionDate` — it only _superseded_ it (ADR 0107), so the send
     record was a bespoke event dated today, not the birthday itself. The
     calendar showed a bespoke campaign on the send day instead of a birthday on
     the birthday;
   - the send occasion's `occasionDate` was `now`, and `computeDispatchDate(now)`
     returns ~5 working days in the **past**, so its fulfilment `dueDate` landed
     last week and the ops queue flagged it overdue — for a card being produced
     today. This affected _every_ immediate one-off send (bulk and guided), not
     just birthdays.

## Decision

1. **Pre-fill the checkout address from the contact record.** The occasion's
   nested `recipient` now carries its stored address (`addressLine1/2`, city,
   postcode); the checkout line is pre-filled from it (still editable) instead of
   starting blank. An address already on file is never re-keyed.

2. **A segment send reuses the natural occasion as its send record, and ships
   "today".** When a bulk-send is reconciled against a natural occasion (e.g. a
   birthday picked from the birthday segment), it no longer mints a superseding
   one-off. Instead it **reuses that occasion as the send record**: it attaches
   the chosen design, flips it to an `asap` send, and checks it out through the
   same `create()` path as any other line. Crucially it keeps the occasion's own
   `type` **and** `occasionDate`, so the card's calendar event sits on the
   _actual birthday_, keeps its birthday classification, and no duplicate
   occasion is created — which also sidesteps the unique
   `(recipientId, type, occasionDate)` index that previously blocked dating a new
   send occasion to the birthday. Because an `asap` send is **paid and produced
   now**, its `dispatchDate` is set to **today** (not back-computed from the
   occasion date), so the ops queue reads it as due now, never overdue.

   Recipients _not_ reconciled against a natural occasion (an ordinary bulk send
   to contacts) still get a fresh `one_off_campaign` occasion, dated at the send
   moment and dispatched today. The same "dispatch today" rule is applied to the
   guided single send (`quickSend`), which had the identical back-dating bug.

   The pre-existing supersede-and-skip settlement (ADR 0107) is retained only as
   a safety net for any order created before this change; new reconciled sends
   set no `supersedesOccasionId`, so it is a no-op for them.

## Consequences

- The two most-reported friction points in the ordering flow are gone: no
  address re-entry, and a birthday card sent via the segment stays a birthday,
  sits on the recipient's real birthday in the calendar, and isn't wrongly
  flagged overdue.
- Reconciling a segment send now _consumes_ the natural occasion directly
  (it moves `scheduled`/`pending_approval`/`approved` → `queued` with the design
  attached) instead of leaving it to be skipped at settlement — so the calendar
  shows one occasion on the right date, not a bespoke duplicate plus a skipped
  natural one.
- `computeDispatchDate` is now used only for genuinely _scheduled_ occasions
  (the auto/birthday scheduler), where back-computing from a future date is
  correct. Immediate one-off sends date their dispatch to the day they're made.
- The occasion `recipient` shape now optionally carries the address; endpoints
  that don't select it still parse (the field is optional).
