# ADR 0056 — Working-day dispatch dates with a seasonal post-rush override

Status: accepted
Date: 2026-07-28

## Context

Every card has a `dispatchDate` — the day Kudos HQ prints and posts it so it arrives before the
occasion. Until now `computeDispatchDate` subtracted plain **calendar** days from the occasion date
(`DEFAULT_POSTAGE_LEAD_DAYS = 5`; `first_class: 3`, `second_class: 5`). Two real-world failures fell
straight out of that:

1. **Weekends and bank holidays don't count.** A birthday on a Tuesday, timed 5 calendar days back,
   dispatched on the Thursday before — but if that window spanned a bank-holiday Monday or a weekend,
   nothing actually shipped on the computed day and the card risked arriving late. The auto-send cron
   acts on `dispatchDate <= today`, so a dispatch date landing on a Sunday just meant the card sat
   until Monday, eroding the lead we'd promised.
2. **December is not a normal month.** The Royal Mail Christmas post rush is slower and Kudos HQ is
   busier; cards for December occasions need to go earlier, and First Class is the safer bet.

This is the highest-impact item in the current batch of work because it's about post physically
arriving on time — the core promise.

## Decision

- **Dispatch dates are computed in working days.** `computeDispatchDate(occasionDate, leadDays)` now
  counts `leadDays` **working days** back from the occasion, skipping Saturdays, Sundays, and UK bank
  holidays. Because it only decrements on working days, the returned date is *itself* always a
  working day — a card is never scheduled to post on a day nothing ships. The lead numbers are
  unchanged in value (`5` default, `3`/`5` per class) but are now working days, so the real calendar
  lead is longer, which is the point.
- **Bank holidays are a bundled constant.** `UK_BANK_HOLIDAYS` (England & Wales, 2025–2028, from
  GOV.UK) ships in code rather than a live fetch: the list is fixed years ahead and dispatch timing
  must be deterministic and offline. It's extended in code as the horizon approaches.
- **A seasonal override adds extra lead and nudges First Class.** `SEASONAL_DISPATCH_RULES` is a
  small, data-driven set of month/day windows, each with `extraLeadDays` and a `suggestFirstClass`
  flag. Seeded with a **Christmas post rush** window (all of December, +3 working days,
  suggest First Class). Occasions dated inside a window get the extra lead automatically; the
  `suggestFirstClass` helper drives a UI nudge ("Royal Mail is slower now — consider First Class") at
  the two points postage is chosen: the **approvals** auto-send postage select and **manual
  checkout** per line. The nudge is one click to apply.
- **The maths lives in `@kudos/shared-types`.** `computeDispatchDate`, the holiday/seasonal
  constants, `isWorkingDay`, `seasonalDispatchRuleFor`, and `suggestFirstClass` are pure and
  dependency-free, so the API (which owns the authoritative `dispatchDate`) and the web (nudges,
  previews) compute identically. `apps/api/.../occasion-scheduling.constants.ts` re-exports them, so
  every existing call site (birthday scheduler, event create/edit, batch orders, auto-send approval,
  quick-send, bulk-send) is upgraded with no import changes.
- **Config is injectable.** `computeDispatchDate` and the helpers accept an optional `holidays` set
  and `seasonalRules` array, defaulting to the bundled constants. This is the seam a future
  admin-editable rule set (via `PlatformSetting`, like seat pricing) plugs into without touching call
  sites — the service layer would resolve the override and pass it in.

## Alternatives considered

- **Live bank-holiday API (GOV.UK `bank-holidays.json`).** Rejected for now: dispatch timing must be
  deterministic and work offline/in tests, and a bundled list is trivially auditable. Refreshing the
  constant is a code change we'll make well ahead of the horizon.
- **Seasonal windows in the database from day one (admin CRUD).** Deferred. The bundled default is
  correct for the launch year and the injectable seam means moving to `PlatformSetting` later is
  additive, not a rewrite. Building an ops screen now would delay the high-value engine.
- **Seasonal extra lead as calendar days.** Rejected: counting it as working days composes cleanly
  with the base calculation (one backward walk) and keeps the "returned date is a working day"
  guarantee.

## Consequences

- Cards now dispatch on real shipping days with an honest lead, and December sends go out earlier
  automatically — the on-time promise holds through weekends, bank holidays, and the Christmas rush.
- The change is behavioural for every dispatch date already in the pipeline as *newly computed*
  (existing stored `dispatchDate`s are untouched until an occasion is re-dated or re-approved).
- The First-Class nudge is advisory, never forced: the sender stays in control of cost vs. speed.
- `UK_BANK_HOLIDAYS` carries a maintenance obligation — extend it before 2028 lapses. Left as a
  clearly-commented constant with a documented trigger.
