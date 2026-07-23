# ADR 0034 — Persisted notification inbox (read/unread history)

Status: accepted
Date: 2026-07-23

## Context

ADR 0030 gave the notification centre a **computed** feed: live "action needed" items derived from
current account state (approvals waiting, occasions coming up, orders to pay, invites pending). It's
always accurate and has no read/unread — but by design it forgets. It can't tell a user that
*something happened*: an order got paid, an auto-send fired overnight, a colleague joined. Those are
point-in-time events a user wants a durable, read/unread record of. This ADR adds that as a
**persisted inbox** alongside — not replacing — the computed feed.

## Decision

### Two things, deliberately kept separate

- **Computed feed** (unchanged, `notifications.service.ts`): live todos, no storage, no read state.
- **Persisted inbox** (new, `notification-inbox.service.ts`): a history of events that already
  happened, each with its own read/unread.

The header bell shows both, in two labelled sections — **"Needs action"** (feed) and **"Recent"**
(inbox). The unread **badge counts the inbox only**: the feed's items are ever-present todos, not
"new," so counting them would mean the badge never clears. This is the one product judgement call
here; everything else follows from the feed-vs-inbox split.

### Fan-out per member, not a shared row + read-join

An account-wide event creates **one `Notification` row per active member** (`notifyAccount` reads
the account's memberships and `createMany`s). Read state is then a plain `readAt` on the row — no
`NotificationRead` join, no "unread = rows with no read record for me" anti-join. For the scale this
serves (tuition centres — a handful of staff per account) the fan-out write is trivial and the
model is far easier to reason about. New members simply don't see pre-existing notifications, which
is the behaviour we'd want anyway. `userId` is the Supabase Auth id, not a Prisma FK — same
convention as `Membership.userId`.

### Idempotent producers

`notifyAccount` takes optional `entityType`/`entityId`; when given, it no-ops if the account already
has a notification for that `(kind, entityId)`. Producers run in at-least-once contexts (Stripe
redelivers webhooks; crons can re-run), so this keeps "one real event → one inbox entry." It also
accepts an optional transaction client so a producer can enlist the write in its own transaction.

Wired producers (the highest-value events for a first cut):
- **`order_paid`** — the Stripe `checkout.session.completed` handler, on first fulfilment only
  (best-effort, after the payment/fulfilment transaction has committed — a notification failure must
  never make the webhook error and trigger a re-fulfil).
- **`auto_send`** — after the auto-send cron sends a card. An action no human triggered is exactly
  what an inbox is for.
- **`invite_accepted`** — inside the accept transaction, fired **before** the joiner's membership is
  created so the fan-out reaches the *existing* team, not the person who just joined.

### API

All under the existing `/notifications` controller (MembershipGuard), scoped to the acting member —
which meant adding `userId` to `CurrentMembershipContext` (the guard already loads the membership):
- `GET /notifications/inbox` — paginated, newest first, with `unreadCount`.
- `GET /notifications/inbox/unread-count` — cheap badge endpoint, loaded on every page.
- `POST /notifications/inbox/:id/read` and `POST /notifications/inbox/read-all` — both scoped to
  `(accountId, userId)` via `updateMany`, so a member can only ever mark **their own** copy read;
  touching someone else's is a silent no-op.

## Alternatives considered

- **Shared `Notification` + `NotificationRead` join** — the "correct at any scale" model, but the
  anti-join for unread counts and the membership-change edge cases aren't worth it for small teams.
  Revisit if an account ever has hundreds of members.
- **Fold events into the computed feed** — rejected: the feed is stateless by design, and bolting
  read/unread onto live-derived items (whose ids change as state changes) is exactly the bookkeeping
  ADR 0030 avoided.
- **A dedicated `/notifications` page** — the bell dropdown covers the need today; a full page is a
  clean future addition using the same paginated endpoint.

## Consequences

- Users get a durable, per-person record of what happened — paid orders, automatic sends, teammates
  joining — with a real unread badge, without losing the always-accurate action feed.
- Producers are idempotent and best-effort (or transactional), so the inbox never destabilises the
  money/fulfilment paths it observes.
- Read state is per-user, so on a team each member has their own unread count.
- Adding a new event type is one `notifyAccount(...)` call at the point it happens plus a kind in the
  shared enum — no schema change.
