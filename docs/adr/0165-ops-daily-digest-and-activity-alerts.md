# ADR 0165 — Kudos HQ daily digest and live activity alerts

Status: accepted
Date: 2026-08-18

## Context

The ops notification centre (ADR 0116) had exactly one producer: the send-by-5 dispatch
reminder. So Kudos HQ was told when cards were **due to post**, and nothing else. A paid
order, a new sign-up — nobody was told. The information existed on `/admin`, but only if
someone went and looked, and nothing marked it as new.

Two things were asked for: a **daily email summary** of what came in and went out, to super
admins; and **all worthy activity** — due dates, new orders, new sign-ups — visible in the ops
notification centre.

The work is small. Defining the numbers correctly is not, and the recon found three ways an
obvious implementation would have been quietly wrong.

## The three traps

### 1. Counting accounts would count guest purchases as sign-ups

A guest one-off purchase mints a real `Account` row — name "Guest", a claim token, **no
membership** (ADR 0025). Counting `Account.createdAt` would therefore report every one-off
card sale as a new sign-up, and the number would look great and mean nothing.

An account becomes a sign-up when it gains an **owner**. `role: "owner"` memberships are
created in exactly two places — normal signup, and a guest claiming the account they bought
from — and invites and role changes are restricted to `admin | staff`, with no ownership
transfer anywhere in the codebase. So "owner memberships created in the window" is exact
rather than approximate, and it correctly counts a guest who later claims.

### 2. `BatchOrder` has no `paidAt`

The obvious query — orders with `createdAt` in the window and a paid status — misfiles any
checkout abandoned and resumed the next day, and **silently drops it from every digest**. A
business summary quietly missing orders is worse than no summary.

Every payment path (Stripe webhook, wallet debit, auto-send, returns reprint) calls
`settleFulfillment` **inside the same transaction that flips the order to `paid`**, and that
creates the order's `FulfillmentJob` rows. So a job's `createdAt` *is* the payment moment, and
the digest keys off it.

A real `paidAt` column would be cleaner, and would also fix the admin overview's revenue
attribution, which buckets by `created_at` today. That's a migration and a backfill; it is
noted in the backlog, not done here.

### 3. A free reprint is not a sale

The returns flow creates a `BatchOrder` already `paid` at £0 as service recovery under the
Kudos Promise (ADR 0039). It matches every "paid order" filter. Counted naively it overstates
daily volume, and it is not revenue. The digest identifies them via
`ReturnCase.recoveryOrderId` and reports them on their own line.

## Decision

### 1. Live alerts — `OpsActivityService`

`new_order` and `new_signup` entries, written the moment the thing happens. `kind` is an open
string on the wire (ADR 0116), so neither needed a schema or client change.

**Called after the originating transaction commits, never inside it.** Two reasons, and the
second is the one that bites: a notification must never fail a payment, and a `try`/`catch`
*inside* a Postgres transaction does not save you — once a statement errors the whole
transaction is aborted, so "best-effort inside the tx" takes the payment down with it.

There is no single post-commit hook for "an order was paid" — `settleFulfillment` is the shared
choke point but runs inside the payment transaction — so the call sits at each of the three
paths that take money: the Stripe webhook, an interactive wallet payment, and auto-send. The
returns reprint deliberately does not call it. Idempotency on `(kind, entityId)` means a
redelivered webhook, or a second call from another path, is a no-op.

Fan-out is to **all** operators, not just super admins: these are routine business events, which
is how `dispatch_reminder` already behaves. Only genuine escalation is role-restricted
(`dispatch_escalation`).

### 2. The digest — `OpsDigestService`

**07:30 Europe/London**, reporting the **previous full London day**. Both halves are
deliberate. Every other cron in the API is UTC-relative, which is right for scheduling — a
posting deadline shouldn't move because the clocks did — but this one is a person's morning,
and a digest that arrives at 08:30 for half the year is a digest nobody set. The *window* is
London too, because "yesterday" in a report means the reader's yesterday: an order placed at
00:30 BST belongs to that day, not the one before. `london-day.ts` derives both from `Intl`,
which already knows the DST history, and steps back a millisecond rather than 24 hours so the
clocks-back day comes out as the 25 hours it really was.

The window is closed when the digest runs, so a re-run gives the same numbers. Emails super
admins (a business summary, not an ops queue), and writes a `daily_summary` entry keyed on the
reported day so a re-fired cron is a no-op.

"Outgoing orders" was read as covering both sides, because each has an exact source and a
summary with only one of them is half a picture: **orders paid** (money in, per the above) and
**cards posted** (mail out, from `FulfillmentJob.postedAt`, stamped exactly on the `posted`
transition).

**Not suppressed on a quiet day**, unlike the dispatch reminder. That reminder is an action
list — nothing to post, nothing to say. This is a report: a zero is a fact, and a silent
morning is indistinguishable from a dead cron.

### 3. An on-demand trigger

`POST /admin/daily-summary/run` (super-admin only) with a button on the ops dashboard, so the
email can be seen and the wiring confirmed on the day it's set up rather than the next morning.
Pressing it twice is safe and does nothing the second time — the same day-key guard.

## Consequences

- Kudos HQ hears about orders and sign-ups as they happen, and gets one morning summary.
- An operator added *after* a day's digest has fired sees no entry for that day — inherent to
  the "first run wins" guard, and the reason the e2e creates its operator up front.
- The digest is only as good as `PlatformAdmin.email`: a super admin with none gets no email
  (they still get the bell entry). The service logs a warning when nobody has one.
- Two new modules' worth of coupling: five feature modules now import `OpsActivityModule`.
  It depends only on Prisma, Email and PlatformNotifications, so there are no cycles.
- Covered by 19 unit tests (wording, idempotency keys, the window, super-admins-only, the
  reprint and guest-account exclusions, and that neither producer can throw) and an e2e that
  proves a real signup through the real route reaches a real operator's bell.

## Alternatives considered

- **Per-event pings only, no digest**, or **a digest only, no live entries.** Rejected: they
  answer different questions — "what needs me now" versus "how did yesterday go".
- **Notify from inside `settleFulfillment`**, the one shared choke point. Rejected: it runs
  inside the payment transaction (see above).
- **Add `BatchOrder.paidAt`.** Correct, and still worth doing; deferred because it is a
  migration with a backfill and this change needs neither.
