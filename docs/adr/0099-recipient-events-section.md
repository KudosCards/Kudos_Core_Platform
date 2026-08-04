# 0099 — Recipient profile: a clearer, action-first Events section

## Status

Accepted

## Context

The Events section on a recipient's profile listed every occasion in one flat,
date-ascending list, with a permanently-expanded "add event" form pinned to the
bottom. Two problems: past and future dates were interleaved with no visual
distinction, so the dates that still need action didn't stand out; and there was
no sense of *when* an upcoming event is — you had to read the date and do the
mental arithmetic. The always-open add form also added noise to a section whose
job is mostly reading and acting on existing dates.

## Decision

Reshape the section around what's coming up, and tuck data entry away.

1. **Upcoming / Past grouping.** Events are split into **Upcoming** (today
   onwards, soonest first) and **Past** (most recent first), under small
   uppercase labels. Past events render at reduced opacity so the eye lands on
   what's still actionable. The header carries the total event count.

2. **A countdown on upcoming events.** Each upcoming date shows a small accent
   pill — "Today", "Tomorrow", "In 5 days", "In 3 weeks", "In 2 months" — so the
   urgency is legible at a glance without date maths. (`daysUntil` +
   `countdownLabel`, day-boundary aligned.)

3. **Birthdays are marked.** Auto-generated birthday occasions get a 🎂 next to
   the name, distinguishing the dates the system maintains from ones the user
   added by hand.

4. **A collapsible add form.** "＋ Add an event" in the section header (and an
   "Add the first event" button in the empty state) reveal the entry form in a
   bordered panel; it closes on a successful add or Cancel. The list leads; entry
   is a deliberate action, mirroring the recipients-page redesign (ADR 0097) and
   the calendar's collapsible event entry.

5. **A friendlier empty state.** A dashed-border prompt ("No events yet — add a
   graduation, work anniversary, or any date worth a card.") with a direct CTA,
   replacing the bare "No events yet." line.

The row rendering (read row + inline edit form) is extracted into a single
`renderEvent` helper reused by both groups, so there's no duplicated markup and
the edit-in-place behaviour is identical wherever a row appears.

## Consequences

- The section now reads as a worklist: upcoming dates lead, each annotated with
  how soon it is, and past history is present but de-emphasised.
- No API or schema change — this is web-only, using the occasion data already
  loaded. All existing capability (add / edit / prepare card / remove / review /
  order link) is preserved, just reorganised.
- Grouping and the countdown are derived client-side from `occasionDate`, so they
  stay correct as events are added or edited without any extra fetch.
