# 0066 — Two-way support ticketing

## Status

Accepted

## Context

Subscribers had no in-product way to reach the Kudos support team, and the team
had nowhere to answer them. Support happened over ad-hoc email, invisible to the
ops portal and impossible to audit. We wanted a genuinely **two-way** channel: a
subscriber raises a ticket from their account area, the support team replies from
the super-admin `/admin` portal, and the thread goes back and forth — with both
sides always able to see whose turn it is — until it's resolved and closed.

The platform already had every building block this needs, so the design reuses
them rather than adding infrastructure:

- The **two-sided module pattern** from Returns (ADR 0039): a member controller
  (`MembershipGuard`, account-scoped) and an ops controller (`PlatformAdminGuard`,
  cross-account) over one shared service.
- **Transactional email** behind `EMAIL_CLIENT` (ADR 0025) with the branded HTML
  fallback, so both notification emails work with no Brevo template and upgrade
  to one when the template ids are set.
- The persisted **notification inbox** (ADR 0034) via
  `NotificationInboxService.notifyAccount`, for the in-app "support replied" item.
- A human reference minted from a Postgres sequence (`TKT-1000+`), mirroring
  `BatchOrder.orderNumber` (`ORD-####`).

## Decision

**Two models** in `apps/api/prisma/schema.prisma`: `SupportTicket` (subject,
category, priority, status, assignee, denormalised `lastMessageAt` /
`lastMessageFrom`) and `SupportTicketMessage` (author type, body, `internalNote`).
`ticketNumber` is an autoincrement sequence starting at 1000, unique, rendered
`TKT-1000`. Both cascade-delete with the account.

**One state machine, expressed as status + "whose turn" (`lastMessageFrom`)** so
both sides can see who owes the next reply:

- customer message (new ticket or reply) → `open`, `lastMessageFrom = customer`;
- support reply → `awaiting_customer`, `lastMessageFrom = support`;
- ops sets `resolved` → resolved (a customer reply reopens it to `open`, clearing
  `resolvedAt`);
- `closed` is terminal — set by the customer or ops; no further replies (409).

**Internal notes are support-only.** An operator can post a message with
`internalNote: true`; it's stored on the thread, visible in the ops detail view,
and **stripped from every customer-facing payload** in the service before it
leaves. An internal note deliberately does **not** change status or whose turn it
is, and never notifies the customer — it's a private annotation, not a reply.

**Notifications, both sides, best-effort** (they log and never fail the workflow
they observe, exactly like Returns):

- customer → support: a new ticket or a customer reply emails
  `SUPPORT_INBOX_EMAIL` (optional; unset ⇒ no email nudge, the ticket is still in
  the ops queue);
- support → customer: a real ops reply fans out a `support_reply` inbox item to
  every account member and emails the account. Each reply is a distinct event, so
  the inbox call is intentionally **not** idempotent (no `entityId`) — unlike the
  once-per-event producers, every reply should surface its own item.

**Assignee is a plain `assignedToUserId` column**, not a foreign key to
`PlatformAdmin`, so the operator table needs no schema change. The ops views
resolve the id → operator email in a single batched lookup. `assign: "me"` claims
a ticket for the acting operator; `assign: "none"` unassigns.

**API surface.** Member (`/support`): list, get (thread, notes stripped), create,
reply, close. Ops (`/admin/support`): queue with a status filter (default: all
not-yet-closed, longest wait first), get (full thread incl. notes), reply
(optionally an internal note), and `PATCH` to change status/priority/assignment.

Validation is class-validator DTOs (the API convention); the shared contract for
the web surfaces lives in `packages/shared-types/src/support.ts`. Enum values are
mirrored by hand across `schema.prisma`, shared-types `enums.ts`, and the DTO
`support-enums.ts`, per the standing Prisma-can't-import-TS convention.

## Consequences

- Support is now first-class in the product: auditable (every action is
  `AuditService`-recorded), visible in ops, and notified on both sides.
- The migration is hand-authored (no DB in the build env) and verified by
  applying it to a real Postgres plus the e2e suite — the two new tables, the
  `TKT` sequence, four enums, indexes, and cascade FKs all apply cleanly.
- No new runtime infrastructure: email and inbox are reused. Setting
  `SUPPORT_INBOX_EMAIL` (and optionally the two `BREVO_SUPPORT_*_TEMPLATE_ID`s)
  activates the email nudges; without them the queue still works.
- Future work left open by the schema without a rewrite: attachments, SLA/first-
  response timers, and canned replies.
