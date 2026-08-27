# ADR 0058 — Drag a card to re-time its dispatch date

Status: accepted
Date: 2026-07-28

## Context

`dispatchDate` — the day Kudos HQ prints and posts a card — is computed from the occasion date
(working days back, ADR 0056). That's the right default, but sometimes a human wants to override it:
send a specific card earlier because the recipient is going away, or bunch a few sends onto one print
day. There was no way to nudge a single card's dispatch day without moving the occasion itself.

## Decision

- **A manual dispatch date is a first-class, sticky override.** New column
  `Occasion.dispatchDateOverridden` (boolean, default false). Setting a manual date stores it in the
  existing `dispatchDate` and flips the flag; the auto-send cron keys off `dispatchDate` unchanged, so
  an overridden card dispatches exactly when placed with no cron changes.
- **One endpoint, set or reset.** `PATCH /occasions/:id/dispatch-date { dispatchDate: string | null }`.
  A date pins it (`dispatchDateOverridden = true`); `null` resets to the working-day calculation
  (postage lead for an approved auto-send, else the default lead) and clears the flag. Guards: only a
  card not yet on an order (scheduled / pending_approval / approved) can be re-timed, and a pinned
  date can't be after the occasion it's for.
- **The override wins over recompute — until the baseline moves.** Approval's auto-send re-timing and
  the event-cohort re-dating skip the recompute when the card is overridden. But changing the
  _occasion date_ (the timing baseline itself) clears the override and recomputes, since the manual
  placement was relative to the old date.
- **Drag-and-drop on the calendar.** With "Dispatch dates" on, month/week grid cards are draggable
  (native HTML5 DnD, no new dependency) and day cells are drop targets; dropping calls the endpoint
  optimistically and reconciles with the server. A 📌 marks an overridden card, and the occasion
  pop-up offers "Reset dispatch date". Drag is gated to the dispatch view (where a card sits on its
  dispatch day, so moving it is meaningful) and to re-timable cards only.

## Alternatives considered

- **A separate `dispatchDateOverride` column with `COALESCE(override, dispatchDate)` everywhere.**
  Rejected: it would touch the auto-send query and every read that cares about the effective date.
  Storing the override _in_ `dispatchDate` plus a flag keeps the effective date in one place and the
  cron untouched; the flag exists only to protect the value from recompute.
- **A drag-and-drop library (dnd-kit, react-dnd).** Rejected for a single, simple interaction —
  native draggable + drop handlers are enough and add no bundle weight.
- **Letting the override survive an occasion-date change.** Rejected: once the occasion moves, a
  dispatch day pinned relative to the old date is usually wrong; recomputing is the safer default, and
  the user can re-drag.

## Consequences

- Users can fine-tune a single card's dispatch day directly on the calendar, without disturbing the
  occasion date or the working-day defaults for every other card.
- The override is deliberately fragile in exactly one way — an occasion-date change resets it — which
  matches the intuition that re-dating the occasion re-plans its timing.
- `dispatchDate` now carries two meanings (computed vs. manually placed), disambiguated by the flag;
  every recompute path checks the flag, and the reset path is the single way back to computed.
