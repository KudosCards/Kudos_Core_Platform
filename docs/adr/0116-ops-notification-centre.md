# 0116 — Ops notification centre

## Status

Accepted

## Context

The send-by-5 dispatch assurance (ADR 0115) delivers two of the three channels
Kudos HQ asked for — an email digest and dashboard priority. The third,
an **in-app admin notification centre**, had no home: the existing `Notification`
inbox (ADR 0034) is **account-scoped** (every row needs an `accountId` and an
account-member `userId`), and platform operators aren't account members. The ops
shell also had no notification surface at all.

## Decision

### 1. A platform-admin notification model

A new `PlatformNotification` table — the operator counterpart of the account
inbox — keyed by the operator's Supabase `userId` (not a Prisma FK, same
convention as `PlatformAdmin.userId` / `Notification.userId`). A platform-wide
event fans out one row per operator, so read state (`readAt`) is per-user.
`entityType`/`entityId` keep a producer idempotent under retries. Indexed on
`(userId, createdAt)` for the inbox list + badge and `(kind, entityId)` for the
idempotency lookup.

### 2. Service, endpoints, and a producer

`PlatformNotificationService` mirrors `NotificationInboxService`:
`notifyAllAdmins()` (idempotent fan-out to every operator), `list`,
`unreadCount`, `markRead`, `markAllRead`. Exposed under `/admin/notifications*`
(list / unread-count / read-all / :id/read), all gated by `PlatformAdminGuard`
and scoped to the calling operator's own rows.

The send-by-5 dispatch reminder (ADR 0115) now writes one entry per day
(`entityId` = today's date) alongside its email — **written regardless of email**,
so an operator with no email set still sees it in the bell. The daily key makes a
re-fired cron a no-op.

### 3. The ops bell

An `OpsNotificationBell` in the ops shell (desktop sidebar footer + mobile top
bar) — the operator counterpart of the account `NotificationBell`, but inbox-only
(no computed feed). Badge = unread count, dropdown lists recent items with
read/unread, "mark all read", and per-row read-on-click.

## Consequences

- The third channel is live: the reminder now reaches operators by **email,
  dashboard, and in-app bell**, all from the one must-ship query (ADR 0115).
- The model is **generic** — `kind` is an open string on the wire — so future
  operator alerts (Click & Drop import errors, returns, support pings) can reuse
  it without a schema or client change.
- One additive table + one migration; no change to the account inbox.
- Covered by an e2e (per-operator inbox + unread + mark-read; fan-out
  idempotency; ops-only auth) and the reminder unit spec (in-app entry written
  once, keyed by date, even when no admin has an email).

## Alternatives considered

- **Reuse the account `Notification` table** with a sentinel account. Rejected:
  it would pollute account-scoped queries and muddy the per-user fan-out model.
- **Skip the model; compute an ops feed live** (like the account "needs action"
  feed, ADR 0030). Rejected: operators want _read/unread_ history of alerts, and
  a persisted inbox is reusable by other producers — the computed approach gives
  neither.
