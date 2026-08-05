# 0117 — Dispatch reminder runtime config + escalation

## Status

Accepted

## Context

The send-by-5 dispatch reminder (ADR 0115) shipped with its behaviour hard-coded:
a fixed weekday cron (`30 7 * * 1-5`), a fixed 5-working-day window, always on,
and no escalation path. Kudos HQ wanted to tune it without a redeploy — pause it
over a quiet period, move the send time, adjust the window — and to route
_persistently_ overdue cards to super admins as a louder alert. The platform
already has the pattern: runtime config in the `PlatformSetting` store, validated
by a shared zod schema, edited from an ops panel (ADR 0059, seasonal rules).

## Decision

### 1. A runtime reminder config

`DispatchReminderConfig` (shared-types): `enabled`, `sendHourUtc` (0–23),
`leadWorkingDays` (the send-by window; 1–15, default 5), `escalateAfterWorkingDays`
(0–15, default 3; 0 = off). Stored as JSON under a new `PlatformSetting` key and
read/written by `DispatchConfigService.getReminderConfig()` /
`updateReminderConfig()`, exactly like the seasonal rules. Exposed as
`GET`/`PUT /admin/dispatch/reminder-config` (PlatformAdminGuard), with an ops
panel on `/admin` (`DispatchReminderSetup`).

### 2. Config-driven cron, without dynamic scheduling

The cron now fires **hourly on weekdays** (`0 * * * 1-5`) and the handler
(`scheduledReminder`) reads the config and proceeds only when `enabled` and the
current UTC hour equals `sendHourUtc`. This makes the send hour and on/off
editable at runtime with no `SchedulerRegistry` gymnastics. The actual work lives
in `runDispatchReminder(config?)`, callable directly (tests, on-demand) without
the gate.

Duplicate sends across API instances are prevented by the in-app notification's
idempotency: `notifyAllAdmins` now **returns whether it created** today's entry,
and only the instance that wins that race goes on to email ("first run wins").

### 3. The send-by window flows everywhere

`mustShip()` reads `leadWorkingDays` from the config, so the dashboard band, the
shell banner, and the reminder all move together when the window changes — one
source, no drift. (`dueCutoffs` gained a lead parameter.)

### 4. Escalation to super admins

Cards overdue by ≥ `escalateAfterWorkingDays` are "critical". When any exist the
reminder additionally writes a `dispatch_escalation` notification and sends an
email **restricted to the `super_admin` role** (`notifyAllAdmins` gained a role
filter). This is the "persistently overdue → escalate" path; `0` disables it.

## Consequences

- Ops can pause, retime, rewindow and tune escalation of the reminder from the
  dashboard — no redeploy, converging across instances on the next read.
- No schema change — config lives in the existing `PlatformSetting` table.
- The hourly cron mostly no-ops (23 of 24 fires) — a trivial cost for avoiding a
  dynamic scheduler.
- Escalation counts "critical" from the bounded must-ship sample (≤50, overdue
  first), so it's exact until a 50+ overdue backlog — a catastrophe the ordinary
  overdue count already screams about.
- Covered by unit tests (enabled/hour gate, first-run-wins guard, escalation
  targeting super admins) and an e2e (config read/update/persist, validation,
  ops-only auth).

## Alternatives considered

- **Dynamic `SchedulerRegistry` cron re-registered on config change.** Rejected:
  more moving parts (re-register hooks, per-instance state) for no gain over the
  hourly-fire-and-gate approach.
- **A separate `escalateAfter` email to a hard-coded ops lead.** Rejected: the
  `super_admin` role already models "who to escalate to", and reusing it keeps
  the recipient set correct as the team changes.
