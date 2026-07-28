# ADR 0059 — Admin-editable seasonal dispatch windows

Status: accepted
Date: 2026-07-28

## Context

ADR 0056 added seasonal dispatch windows: occasions dated inside a window (seeded with the December
Christmas post rush) get extra working-day lead and can nudge senders toward First Class. That was
deliberately a **bundled constant** — correct for launch, but the actual lead a busy period needs is
a judgement call that should track real Royal Mail behaviour, and it changes year to year (exact
Christmas cut-offs, a possible summer-holidays window). Editing a constant and redeploying to change
a date is the wrong workflow for ops, so this makes the windows admin-editable at runtime.

The friction: `computeDispatchDate` is a **pure, synchronous** function called in ~10 places (occasion
create, birthday scheduler, event create/edit, batch orders, auto-send approval, dispatch reset).
Threading async DB-backed config through every call site would make them all async and touch a lot of
code.

## Decision

- **The seasonal rules are a runtime-configurable default in `@kudos/shared-types`.** A process-wide
  mutable `activeSeasonalRules`, seeded with `DEFAULT_SEASONAL_DISPATCH_RULES` (the Christmas window),
  is what `computeDispatchDate` / `suggestFirstClass` / `seasonalDispatchRuleFor` fall back to when a
  caller doesn't pass its own. `setSeasonalDispatchRules()` swaps it; per-call overrides still win.
  Net effect: **zero call-site changes** — every dispatch computation honours the admin config once
  it's loaded, and callers that pass explicit rules (tests) are unaffected.
- **The API owns loading and persistence.** `DispatchConfigService` reads the rules from the existing
  `PlatformSetting` key/value store (`dispatch_seasonal_rules`, JSON), applies them to the engine on
  boot (`OnModuleInit`), and re-applies on an admin edit. It falls back to the bundled default when
  nothing is stored or a stored value fails validation, so a bad row can never break dispatch maths.
- **Validated by the shared zod schema.** `seasonalDispatchRulesSchema` (bounds on month/day, lead
  days 0–30, ≤24 windows) is the single source of truth for the shape; the admin DTO only guards the
  envelope. An invalid window is a 400, not a stored landmine.
- **Ops edits it in-app.** Platform-admin `GET/PUT /admin/dispatch/seasonal-rules` (behind
  `PlatformAdminGuard`) back a table editor on the ops dashboard — add/edit/remove windows, save, or
  reset to the bundled default. Applied immediately, no redeploy — the same in-app-config posture as
  the seat-price provisioning (ADR 0037).
- **Cross-instance freshness via a short refresh.** The cache is per-process, so an edit on one API
  instance is re-read by the others within a few minutes via a timed reload (`@Interval`). Seasonal
  rules change ~yearly, so minutes of staleness across instances is immaterial; the alternative
  (reading the DB on every sync dispatch computation) isn't worth its cost.

## Alternatives considered

- **A `DispatchConfigService.computeDispatchDate(...)` injected into every service.** Cleaner DI, but
  it touches ~10 call sites and their modules for a value that changes once a year. The
  runtime-default keeps the pure function pure at the edges and centralises the one piece of mutable
  state behind an explicit, documented setter.
- **Read the rules from the DB per computation (always fresh, multi-instance-correct).** Rejected:
  makes `computeDispatchDate` async and adds a query inside order-building loops and crons, for a
  config that's effectively static.
- **Make the bank-holiday set editable too.** Deferred — holidays are fixed years ahead and rarely
  wrong; the same seam (`DispatchDateOptions.holidays`) is there if it's ever wanted.

## Consequences

- Ops can tune the Christmas lead, shift the exact window each year, or add a summer-holidays window
  against real delivery data — no engineer, no deploy.
- One piece of deliberate mutable global state exists (`activeSeasonalRules`); it's confined to the
  dispatch module, only written by `setSeasonalDispatchRules`, and reset to default in tests via
  `afterEach` so it can't bleed between them.
- The web keeps the bundled default for its advisory First-Class nudge (it never calls the setter);
  the API remains authoritative for the actual stored `dispatchDate`, so the two can't disagree in a
  way that matters.
- Multi-instance edits converge within the refresh interval rather than instantly — acceptable for a
  yearly-changing config, and documented.
