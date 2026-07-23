# ADR 0030 — Settings hub + notification centre

Status: accepted
Date: 2026-07-23

## Context

The sidebar had grown to ~13 links across four groups as features shipped (Bulk send, Calendar,
Approvals, Checkout, Orders, Recipients, Integrations, Designs, Messages, Team, Wallet, Billing).
The owner flagged it as "starting to look heavy" and asked for two things:

1. a **settings page** to consolidate the account-management surfaces, and
2. a **notification centre** — a quick, in-app view of upcoming events and other things worth
   knowing.

## Decision

### Settings hub (`/settings`)

A single sidebar entry, **Settings**, replaces the four-item "Account" group and pulls Integrations
out of "Grow relationships". The hub is a lightweight page of link cards to the **existing**
routes — Team, Integrations, Billing & plan, Wallet — plus inline notification preferences (the
reminder-emails opt-out, which previously only lived on Billing). The sub-pages keep their routes,
so nothing breaks and there are no redirects; the hub is pure consolidation.

Result — a leaner sidebar:
- **Overview**: Dashboard
- **Send cards**: Bulk send, Calendar, Approvals, Checkout, Orders
- **Grow relationships**: Recipients, Designs, Messages
- **Account**: Settings

The wallet balance chip in the header is now a link to `/wallet`, so the wallet stays one click away
despite leaving the sidebar.

### Notification centre — a computed feed, not a persisted inbox

A **bell** in the app-shell header opens a "quick view" panel. Its feed comes from a new
`GET /notifications` endpoint that **computes** items live from the account's current state:

- occasions waiting in the approvals queue,
- occasions coming up in the next 21 days (approved/scheduled, with recipient + date),
- orders in `draft` awaiting payment,
- pending team invites (shown only to owners/admins, who can act on them).

Deliberately **stateless** — there is no `Notification` table, no read/unread bookkeeping. The feed
is therefore always accurate and never shows a stale or already-handled item: when you approve the
last occasion, it's simply gone next time the panel opens. The badge count is the number of live
items. Actionable items (approvals, unpaid orders, invites) are ordered above the informational
upcoming events. The panel refetches each time it's opened.

## Alternatives considered

- **A persisted notification inbox** (a `Notification` row per event, mark-as-read) — rejected for
  now: it's a much bigger surface (write path on every state change, read/unread sync, cleanup) for
  a first version whose ask is "a quick view of what's worth knowing." A computed feed delivers that
  with zero new schema and no staleness. A persisted inbox remains a clean future addition — the
  `GET /notifications` shape can absorb persisted items later without changing the client.
- **Settings as a tabbed page that embeds Team/Billing/etc.** — rejected: it would duplicate or move
  working pages for no benefit. Link cards to the existing routes are lower-risk and just as clear.

## Consequences

- The sidebar is materially leaner while every surface stays reachable (Settings hub + the header
  wallet link).
- Users get a live, at-a-glance sense of what needs doing (approvals, payments) and what's coming up
  (birthdays), from anywhere in the app.
- The notification feed adds one small aggregate query per open; it reuses existing indexes
  (occasion status/date, batch-order status) and is account-scoped.
