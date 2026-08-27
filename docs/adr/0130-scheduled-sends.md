# 0130 — Pay now & send now / schedule later (ad-hoc scheduled sends)

## Status

Accepted

## Context

Every ad-hoc card purchase — the "Send a card" bulk composer (`/send`) and the
guided single-card wizard (`/designs/[id]/send`) — posted **today**. The order
engine hard-coded the created occasion's `dispatchDate` to `today`, so there was
no way to buy a card now and have it posted later, and the checkout never even
said _when_ a card would go — a customer couldn't tell "send today" from
"schedule". Auto-send birthdays already pay-once-post-later on a computed
`dispatchDate`; ad-hoc sends had no equivalent.

The dispatch backbone to support later sending already existed: an occasion's
`dispatchDate` (the post-by date) is denormalised onto each `FulfillmentJob` as
its `dueDate` at settlement, and the ops queue sorts and buckets by that date
(overdue / today / due-soon / **upcoming**), with a dispatch calendar and
send-by-5 reminders on top. The only missing piece was letting the customer
choose that date.

## Decision

Offer **Send now** vs **Schedule delivery** at payment across the two logged-in
send flows, choosing an **arrive-by** date. Payment is taken now either way;
scheduling only changes when the card is posted.

1. **Arrive-by, not post-by.** The customer picks the date they want the card to
   _land_; the API back-computes the **post-by** (`dispatchDate`) from it with
   the same working-days + seasonal lead engine occasions use
   (`computeDispatchDate(deliverBy, POSTAGE_LEAD_DAYS[class])`). "Send now" keeps
   the today/today behaviour (ADR 0119) so it reads as due-now, not overdue.

2. **Shared helpers, one source of truth.** `deliverByWindow(postageClass)` in
   `@kudos/shared-types` returns the bookable range — earliest (soonest a card
   posted today could arrive) to `MAX_SCHEDULE_AHEAD_DAYS` (365) out — used by
   both the web date picker and the API. The API additionally rejects any date
   whose computed post date is already in the past (seasonal lead can push it
   earlier than the approximation), so the picker and the guard agree.

3. **A single optional field.** `deliverBy` (`YYYY-MM-DD`) on the bulk-send and
   quick-send inputs; absent = send now. The service's `resolveSendSchedule`
   sets the occasion's `occasionDate`/`dispatchDate` accordingly (for a segment
   send that _reuses_ a natural birthday occasion, the birthday `occasionDate`
   is kept and only `dispatchDate` is set — `dispatchDate` is what drives
   posting). Everything downstream — `dueDate`, the ops queue bucket, the
   dispatch calendar, the reminders — flows unchanged.

4. **Shared "When should this go?" control.** One `SendTimingPicker` component,
   used by both flows, showing the two options, the date field bounded to the
   window, and a live "arrives around X · we post it Y" line from the same
   engine. The order summary CTA becomes **Pay & send** / **Pay & schedule**, so
   the timing is explicit even for send-now — the original ambiguity is gone.

5. **Managing a scheduled order (follow-up in the same initiative).** Because a
   scheduled card is paid but not yet posted, the customer can **reschedule** it
   (change the arrive-by date) while none of its cards have printed — recomputing
   the occasion `dispatchDate` and the pending jobs' `dueDate`. **Cancelling** a
   _paid_ order means a refund, which the platform still defers (ADR 0008), so
   for now cancel-after-payment routes to support/ops (who refund in Stripe);
   self-serve refund-on-cancel is a deliberate later decision.

## Consequences

- Customers can buy now and have a card arrive on a chosen date, from the same
  two-tap flow — and every checkout now states whether it sends today or is
  scheduled, fixing the "when does this go?" ambiguity.
- No money-path change: payment is taken at checkout exactly as before; only the
  post date differs, matching the existing auto-send model. No schema/migration
  — it reuses `Occasion.dispatchDate` → `FulfillmentJob.dueDate`.
- The guest basket (`/guest/cart-checkout`) is unchanged for now; it gets the
  same timing choice as a fast follow.
- Reschedule is fully self-serve; true self-serve cancel/refund is deferred with
  ADR 0008 and can be lifted when the platform takes on automated refunds.
