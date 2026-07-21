# ADR 0016 — Recipient birthdays on the calendar, per-recipient events, and lists

Status: accepted
Date: 2026-07-21

## Context

Three connected gaps surfaced once accounts started bringing recipients in through the CRM
integrations (ADR 0015):

1. **Birthdays weren't reaching the calendar.** A recipient's date of birth was on file, but the
   only thing that ever turned it into an `Occasion` was the nightly birthday scheduler — and that
   cron only materialised occasions for birthdays inside a 21-day lookahead window. So a recipient
   added in July with a December birthday produced *nothing* on the calendar until December. To the
   subscriber it looked like the CRM data simply hadn't landed. This was the reported bug.

2. **No way to record other dates worth a card.** A birthday is one moment; a teacher also wants to
   mark a graduation, the end of exams, and so on — and see them on the same calendar.

3. **No way to organise recipients.** A teacher with several classes wants named groups —
   "Year 4 class", "Year 5 class" — to keep personalisation manageable.

## Decision

### 1. Birthdays become a calendar event the moment a recipient is added

The `Occasion` model already had a `scheduled` status that nothing used. It's exactly the right
tool: a *calendar marker that isn't yet an actionable card*. We now:

- **Eagerly create a `scheduled` birthday occasion** for the recipient's next birthday whenever a
  recipient with a DOB is added — through every path: manual create, CSV import, and CRM ingest
  (`RecipientsService.ingestFromSource`). A single shared builder,
  `buildScheduledBirthdayOccasion`, keeps the row shape identical everywhere, and every insert uses
  `skipDuplicates` against the existing `occasion_idempotency_key (recipientId, type, occasionDate)`
  so it's idempotent no matter how many code paths run.
- **Keep the approvals queue clean.** A `scheduled` occasion is on the calendar but *not* in the
  approvals queue (which filters to `pending_approval`). The nightly scheduler's job changes from
  "create pending_approval occasions in the window" to two idempotent steps: (a) ensure every active
  recipient with a DOB has a `scheduled` birthday occasion, and (b) **promote** the ones that have
  entered the 21-day window to `pending_approval`, where the existing approve → order → dispatch
  (and auto-send) flow takes over unchanged.
- **Re-point on change.** Editing a recipient's DOB replaces their `scheduled` birthday occasion;
  occasions already in the pipeline are left alone.

This means the birthday is the account's "first scheduled event" immediately on add — the outcome
the user asked for — while the money/dispatch path is untouched.

### 2. Per-recipient events

Subscribers can add their own dated events to a recipient (`POST /occasions/events`). These are
`scheduled` occasions too — on the calendar at once, out of the approvals queue until the subscriber
chooses to act. A new nullable `Occasion.title` carries the human label ("Graduation", "End of
exams") so the calendar shows the real name rather than a broad `type`. Two new transitions round it
out: `POST /occasions/:id/prepare` promotes a scheduled event into the approvals queue on demand,
and `DELETE /occasions/:id` removes a scheduled event (scheduled-only — once an occasion is in the
pipeline it's part of an order's history and is skipped, not deleted).

**Recurrence.** Birthdays recur because the scheduler re-derives them from the DOB each year.
Custom events are single-date for now (a graduation is a one-off; an annual event is re-added). A
recurrence rule on custom events is a deliberate later step, not part of this change.

### 3. Recipient lists

Two new tables — `RecipientList` and a `RecipientListMembership` join — give a many-to-many grouping
that's purely organisational: it drives filtering and bulk personalisation, not occasions or
billing. Lists are account-scoped, names are unique per account, and memberships cascade-delete with
either side. The recipients list gains a `listId` filter; the CRUD + membership endpoints live in a
small `recipient-lists` module. Deleting a list never touches the recipients on it.

## Alternatives considered

- **A dedicated `RecipientEvent` model** separate from occasions, with the calendar merging two
  sources. Cleaner in the abstract, but it duplicates the occasion's date/status/dispatch machinery
  and forces the calendar (and the money path) to understand two overlapping concepts. Reusing the
  already-present `scheduled` status gives one model, one calendar query, and no change to the
  approve/order/dispatch flow.
- **Eagerly creating `pending_approval` birthdays** on add. Rejected: it floods the approvals queue
  months ahead with items no one is ready to action. `scheduled` keeps "on the calendar" and "needs
  a decision now" as distinct states.

## Consequences

- The calendar is populated from real CRM data the instant recipients arrive; the reported bug is
  fixed at its root, not patched at the read side.
- `scheduled` is now a load-bearing status: any future occasion consumer must treat it as
  "not yet actionable" (the approvals queue, batch orders, fulfilment, and auto-send all already
  filter to their own statuses, so none pick it up by accident).
- Two migrations (`recipient_lists`, `occasion_title`) and matching `shared-types` schemas ship with
  this change; the enum list of occasion statuses is unchanged (`scheduled` already existed).
