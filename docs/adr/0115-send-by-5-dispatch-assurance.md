# 0115 — Send-by-5 dispatch assurance

## Status

Accepted

## Context

Kudos HQ's operating rule is that **every ordered card is posted at least 5
working days before its delivery date**, so nothing arrives late. The deadline
maths already existed — the working-day dispatch engine (ADR 0056) computes a
per-card `dispatchDate`, denormalised onto `FulfillmentJob.dueDate` at payment
(ADR 0108) — and the ops queue, dispatch calendar (ADR 0110) and Must-ship band
(ADR 0111) all let an operator _see_ urgency. But two gaps meant the rule wasn't
actually assured:

1. **First class posted too late.** The lead was per-postage-class — `first_class:
3`, `second_class: 5` working days — so a first-class card's deadline was set
   only 3 working days out, breaking the 5-working-day rule.
2. **No push, and an under-count.** Every urgency surface was _pull_ — someone had
   to open a dashboard. And the Must-ship band read `counts.due`, which is
   computed for `status = 'pending'` only, so a card `printed` but not yet
   `posted` and past its deadline wasn't counted as overdue.

## Decision

### 1. A single send-by-5 lead (all classes)

`POSTAGE_LEAD_DAYS` is now `{ first_class: 5, second_class: 5 }`. Every class
posts at least 5 working days before the delivery date, so the print/post team
works to one deadline. Kept as a per-class map so a class could be given a longer
run later without touching call sites. Only affects orders placed after the
change; existing `dueDate`s are untouched. (The First-Class _nudge_ is unaffected
— it keys off seasonal windows, not the lead gap.)

### 2. One shared must-ship query

`FulfillmentService.mustShip()` is the single source of truth: it counts every
**open** (not-yet-posted — `pending` / `in_progress` / `printed`) card whose
deadline is **overdue / today / within 5 working days**, and returns the most
urgent ones (bounded). Spanning open statuses fixes the printed-but-overdue
under-count. Exposed as `GET /fulfillment/must-ship` (PlatformAdminGuard); the
web contract is `mustShipSummarySchema` in shared-types. The email, dashboard band
and shell banner all read this one query, so they can never disagree.

### 3. The push — a weekday reminder to Kudos HQ

`DispatchReminderService` runs a cron every weekday morning (`30 7 * * 1-5`,
after the auto-send cron) and emails **all platform admins** a branded digest of
cards to post, grouped overdue / today / within-5, deep-linked to the queue.
Weekends are skipped (HQ doesn't print/post; Monday carries the weekend's cards).
**Suppressed when nothing is due**, so the digest stays a signal. Sent per-admin
with per-recipient error isolation, mirroring `RemindersService`.

### 4. Priority elevation in the app

- A **shell-wide banner** across every ops page (red when anything is overdue,
  amber when only due-today), linking straight to the queue.
- The **/admin Must-ship band** now sources its Overdue / Due-today /
  Due-within-5 counts from `mustShip` (accurate, open-status) rather than the
  pending-only `counts.due`, and leads with a priority callout when action is due.

## Consequences

- The 5-working-day rule is now actually enforced (correct deadlines) **and**
  assured (a daily push + unmissable in-app priority), not just visible on demand.
- One additive endpoint, no schema change — `mustShip` derives from existing
  columns (`dueDate`, `status`).
- The digest lists recipient name + city — the same fields the ops queue already
  exposes, and only to platform admins; no new PII surface.
- Minor: a Must-ship tile shows the open-status count but its `?due=` link lands
  on the pending-scoped queue view, so a printed-overdue card appears under the
  Printed tab rather than the linked filter. Acceptable; extending the queue's
  `due` filter across open statuses is deferred.
- Covered by a unit spec (reminder: suppress-when-empty, dedupe, overdue-led
  subject, no-recipients) and an e2e (must-ship spans printed-overdue; ops-only).

## Follow-ups (not in this change)

- **Admin notification centre** — a `PlatformNotification` model + ops-shell
  inbox so the reminder also lands in-app (the third channel), reusable for
  Click & Drop errors and returns.
- **Runtime knobs + escalation** — reminder on/off, send time, lead window, and
  escalate-persistently-overdue to `super_admin`, via the DispatchConfig panel.
