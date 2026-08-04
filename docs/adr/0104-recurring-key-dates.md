# 0104 — Renewal & anniversary as recurring occasion types (key dates)

## Status

Accepted

## Context

The occasion engine only auto-generated **birthdays** (from `Recipient.dateOfBirth`).
Everything else was a hand-created one-off. User feedback asked to treat
**renewals** and **anniversaries** as their own recurring, separately-sendable
streams — the first slice of the "occasion-driven smart lists" work (a segment
like "Renewals due this month" needs renewals to exist as dated, tracked
occasions, not as ad-hoc contact lists).

## Decision

Add `renewal` and `anniversary` as first-class recurring occasion types, driven
by a generic per-recipient **key date**, so they inherit the whole birthday
machinery (calendar presence, lifecycle, approval, dispatch timing, auto-send
eligibility) for free.

1. **New occasion types.** `renewal` and `anniversary` added to `OccasionType`
   (Prisma enum + `occasionTypeSchema` + `OCCASION_TYPE_LABELS`). A shared
   `RECURRING_OCCASION_TYPES` constant names the auto-generated set.

2. **A generic `RecipientKeyDate` table** (chosen over fixed
   `renewalDate`/`anniversaryDate` columns) — `type` (`KeyDateType`), `date`
   (the annual anchor), optional `label`. Extensible to future recurring streams
   without a schema change, and it keeps birthdays (which stay on
   `dateOfBirth`) and key dates modelled the same way. One row per type per
   recipient (`@@unique(recipientId, type)`).

3. **Occasion generation mirrors birthdays exactly.** `buildScheduledKeyDateOccasion`
   is the direct analogue of `buildScheduledBirthdayOccasion` — same annual
   month/day recurrence (`nextBirthdayOccurrence`, reused as-is), same
   working-days dispatch timing, same `scheduled` start. Occasions are created
   **eagerly** when a key date is set (so the calendar populates immediately) and
   swept by the existing daily scheduler, which now also rolls key dates forward
   and promotes `birthday`/`renewal`/`anniversary` occasions inside the lookahead
   window into the approvals queue. The `occasion_idempotency_key`
   (recipientId, type, occasionDate) keeps every path idempotent.

4. **API.** `GET/PUT/DELETE /recipients/:id/key-dates[/:type]`. Setting a key date
   re-points its still-`scheduled` occasion at the new date (an occasion already
   in the approval/dispatch pipeline is left alone — the same rule the date of
   birth uses); removing it clears the scheduled occasion.

5. **Web.** The recipient profile gains a **Key dates** card (Renewal /
   Anniversary) — set/update/remove — and the generated occasions appear in the
   profile's Events list and on the calendar automatically.

6. **Approval-only to start.** Renewal/anniversary occasions are created
   `scheduled` and promoted to `pending_approval` like birthdays; they are **not**
   auto-send by default (auto-send stays an explicit per-occasion opt-in at
   approval). Making them auto-send-eligible is a later, deliberate step.

## Consequences

- Renewals and anniversaries are now dated, tracked, per-year-de-duplicated
  occasions — the substrate the occasion-driven segments ("Renewals due",
  "Anniversaries this month") in the next slice will filter on, exactly as
  planned.
- No bespoke scheduling: they ride the birthday scheduler, dispatch engine, and
  approval/checkout flow unchanged. The scheduler's promotion step now covers all
  three recurring types.
- One additive table + enum values (migration `20260804170000_recurring_key_dates`),
  plus per-recipient endpoints. Birthdays are untouched; the `RecipientKeyDate`
  model can later absorb them or new recurring streams without further schema work.
