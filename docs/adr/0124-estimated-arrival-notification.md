# 0124 — Estimated-arrival notification for untracked stamped post

## Status

Accepted

## Context

Buyers wanted to be told when their card reaches the recipient — an "out for
delivery / delivered" email. Phase 1 (ADR 0121) built a Royal Mail **tracking**
poll for exactly this. But Kudos posts cards on **ordinary stamps**, and Royal
Mail does **not track** standard letter post: no tracking number, no "out for
delivery" scan, no delivery scan. So there is no carrier event to react to — the
tracking poll is inert for stamped mail, and a *real* delivery email is
impossible. Anything we send about delivery is necessarily an **estimate**.

Two consequences beyond the email itself: (1) we must never assert "Royal Mail
delivered your card" when we can't know it — that's a false claim to a paying
customer; (2) without any delivery signal, stamped cards would sit in `posted`
forever and their orders would never reach `completed`.

## Decision

Replace the (unusable-for-stamps) tracking-based email with an **estimated
arrival** email driven by the posting date, and treat that estimate as the
delivery point — because to Kudos, on untracked post, "should have arrived" *is*
the delivery confirmation.

### 1. Estimate from posted date + postage-class transit

A daily sweep (`FulfillmentService.notifyEstimatedArrivals`) looks at `posted`
cards and computes each one's estimated arrival as `postedAt + transit working
days`, using the existing UK-holiday-aware working-day engine (`addWorkingDays`).
Transit per class comes from config — `ARRIVAL_FIRST_CLASS_WORKING_DAYS` (default
1) / `ARRIVAL_SECOND_CLASS_WORKING_DAYS` (default 3), Royal Mail's own aims —
tunable without a code change.

### 2. Mark delivered (estimated) + email, once

When a card's estimated arrival has passed, the sweep advances it `posted →
delivered` through the **existing audited state machine** (`applyTransition`,
system actor `system:arrival-estimate`), stamping `deliveredAt` with the
**estimate** (not "now"), which cascades the OrderRecipient/Occasion and rolls the
order up to `completed`. It then emails the buyer, grouped one-per-order, an
**honest** "your card **should have** arrived" note — never "was delivered" — with
an explicit line that standard post isn't tracked. Idempotency is free: a card
that transitions leaves the `posted` set, so a later sweep can't re-process or
re-email it — the same guard the manual and delivery-poll paths use.

### 3. Backlog guard + opt-in

The sweep only considers cards posted within `ARRIVAL_MAX_POSTED_AGE_DAYS`
(default 14) so enabling it can't email + auto-complete a historical `posted`
backlog in one run, and so a weeks-late "should have arrived" note is never sent.
Because it both emails customers and advances order state on an estimate, it is
**opt-in**: the daily cron (`ArrivalNotificationService`, 09:00 UTC) runs only
when `ARRIVAL_NOTIFICATIONS_ENABLED` is `"true"`/`"1"`. An ops-only `POST
/fulfillment/notify-arrivals` forces a sweep on demand (and makes it testable).
Optional Brevo template `BREVO_ARRIVAL_TEMPLATE_ID`, else the branded HTML
fallback.

## Consequences

- Buyers get a timely, honest "should have arrived" email around the real arrival
  window, and stamped orders now reach `completed` instead of sitting in `posted`
  forever.
- No schema change — reuses `postedAt`/`deliveredAt` and the `posted → delivered`
  guard for idempotency. The per-order email grouping was extracted
  (`groupJobsIntoOrders`) and is now shared with the dispatch email.
- `deliveredAt` for stamped mail is an **estimate**, clearly framed as such to the
  customer; the ops trail (ADR 0122) shows it like any delivered date.
- Off by default; a one-line env change enables it. Tuning transit/window needs an
  env change (restart), not a redeploy of code.
- The Phase 1 tracking poll remains as the path that lights up for real **if**
  Kudos ever moves to a tracked Royal Mail service — the two coexist.
- Covered by an e2e (past-transit → delivered with estimate time + `completed`
  roll-up + system-actor audit + one honest email + no re-send on a second sweep;
  just-posted left alone; old-backlog skipped; ops-only auth).

## Alternatives considered

- **Send a "delivered" email off Royal Mail tracking (ADR 0121 path).** Rejected:
  stamped post isn't tracked, so it can never fire — and asserting delivery we
  can't verify is misleading.
- **Email at posting time ("expect it by X").** Rejected as redundant: the
  existing "posted" dispatch email (ADR 0025) already tells the buyer it's on its
  way. The value is a note *around arrival*, which this delivers.
- **A new `arrivalNotifiedAt` column for idempotency.** Rejected: advancing to
  `delivered` already makes the card unselectable next sweep, so a dedicated
  marker would be redundant state.
- **Leave cards in `posted` and only email (no state change).** Rejected: orders
  would never complete on untracked post, and the buyer's stated model is that
  "should have arrived" is the delivery.
- **A runtime PlatformSetting knob + ops UI for transit/window.** Deferred: env
  config matches the existing tunables (RM service codes, reaper) and keeps this
  PR focused; promoting to a UI knob is a clean follow-up.
