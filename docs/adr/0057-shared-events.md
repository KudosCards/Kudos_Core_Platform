# ADR 0057 — Shared events: one card, many contacts, one calendar entry

Status: accepted
Date: 2026-07-28

## Context

The old system had a concept the rebuild was missing and the business flagged as important: a
**shared event** — a single card sent to a whole cohort of contacts on the same date (End of Year,
Results Day, SATs week, a Christmas send). Until now the calendar only had _occasions_: birthdays
(auto-scheduled, one per recipient) and hand-added per-recipient events, plus org-wide one-off
campaign occasions with no attached contacts. There was no way to say "these 30 leavers all get this
card on 17 July" and manage them as one thing. Bulk-send (ADR 0052) could post one design to many
contacts as a single order, but it left nothing named and persistent on the calendar to plan around.

## Decision

- **An `Event` is a first-class entity; its members are Occasions.** A new `Event` row owns the
  title, type, date, and notes. Each attached contact becomes a member `Occasion` with
  `source = shared_event`, `eventId` set, and the event's title/type/date copied down. This
  deliberately reuses the entire occasion pipeline — calendar rendering, approvals, checkout,
  auto-send, order links (ADR 0055), sent-state (ADR 0055) — instead of building a parallel one. A
  member is just an occasion that happens to belong to an event.
- **The calendar collapses members into one entry.** `GET /events?from&to` returns per-event rollup
  counts (`memberCount`, `sentCount`); the calendar renders one `EventPill` (title + "sent/total"),
  not N scattered occasion pills. Opening it manages the cohort. **Double-clicking a day** (or the
  hover "+ event" affordance, or the header button) opens the create modal with that date prefilled,
  reusing the bulk-send `RecipientPicker` to attach contacts.
- **Send the whole cohort in one order.** `POST /events/:id/order` takes one design + postage,
  approves every still-unsent member with it, addresses each from the contact's **stored** record,
  and rolls them into a single draft order via `BatchOrdersService.create` — the exact money path
  manual checkout and bulk-send already use. The web then drives that draft through the normal Stripe
  checkout. No new payment code, no parallel order path.
- **Editing cascades to unsent members only.** Changing the event's date re-dates (and recomputes the
  working-day dispatch date, ADR 0056) every still-unsent member; title/type changes cascade too.
  Members already ordered are history and are left untouched.
- **Lifecycle guards mirror occasions.** A member can be removed only while unsent; an event can be
  deleted only if no member has been sent (else the order history it belongs to would be destroyed) —
  a 409 explains why. Member occasions cascade-delete with the event at the database level.
- **Everything is account-scoped and audited.** Every read/write is filtered by `accountId`, contact
  attachment only accepts recipients the account owns, and each mutation records an audit entry
  (`targetType: "Event"`).

## Alternatives considered

- **A standalone Event with its own members table, materialising occasions only at order time.**
  Rejected: it would duplicate calendar/approvals/sent-state logic and hide per-contact progress until
  send. Members-as-occasions gets all of that for free and shows live status per contact.
- **"Apply the same named event to each selected contact" (N independent per-recipient occasions,
  no Event row).** Rejected — the lighter option from the plan. It can't render as one calendar entry,
  can't be edited/sent/deleted as a unit, and re-scatters the exact clutter the feature exists to fix.
- **Reusing bulk-send directly for the cohort send.** Rejected as the primary model because bulk-send
  creates _new_ one-off occasions; an event's members already exist, so ordering must consume them,
  not duplicate them. We still reuse bulk-send's address-gathering and the shared `create` money path.

## Consequences

- Schools can plan and send a whole-cohort card as one named thing on the calendar, restoring a
  valued feature from the old system.
- The occasion `@@unique([recipientId, type, occasionDate])` key is not event-aware, so attaching a
  contact who already has an occasion of the same type on the event's date is silently skipped
  (`skipDuplicates`) rather than failing the create — a rare edge (e.g. the event's type/date collides
  with that contact's birthday). Acceptable for now; adding `eventId` to the key is a clean later
  change if it bites.
- Deleting an event cascades to its member occasions in the DB, but the service blocks deletion once
  any member is sent, so no order history is ever lost.
- The cohort-order path returns an unpaid draft; payment stays a deliberate second step (the existing
  checkout), so no money moves without a human paying — consistent with every other order path.
