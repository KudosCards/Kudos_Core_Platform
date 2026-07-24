# ADR 0041 — Super admin "Customer 360": engagement tracking

Status: accepted
Date: 2026-07-24

## Context

The super admin portal (ADRs 0010, 0032/redesign, 0040) tracked the money layer well —
platform-wide KPIs, an orders list, and a subscribers list with spend and a derived health pill.
But the platform has since grown a large **engagement surface** that the portal was blind to:
contacts (sourced manual/CSV/CRM/API), lists, scheduled occasions + auto-send, CRM connections and
their sync health, inbound API keys, the wallet, digital message-page views, teams + seats, and
returns.

Two concrete gaps:

1. **No customer detail view.** Subscriber rows were dead-ends — you could not open an account and
   see who it is or what it's doing.
2. **"Activity" was order-only.** A customer who subscribed but never uploaded a contact or connected
   a CRM looked healthy, when they're actually an activation risk. None of the engagement signals
   were visible per customer.

## Decision

Add a **Customer 360** to the super admin portal: one account's full profile and engagement,
aggregated across every surface, behind `GET /admin/customers/:id` (PlatformAdminGuard) and rendered
at `/admin/subscribers/[id]`.

- **`AdminCustomerService.getCustomer(accountId)`** fans out a set of parallel Prisma queries (this is
  a single-account *detail* view, so a fan of ~24 reads is fine — unlike the list, which must stay
  cheap per row). It returns: profile + subscription/billing, team + seat usage, contacts (by status
  and by source, plus lists and address-hold count), occasions (scheduled/auto-send/upcoming),
  integrations (CRM connections + API keys), wallet balance, saved designs, message-page views,
  order history + status breakdown, and returns.
- **Derived engagement.** A `lastActivityAt` computed across *all* signals (orders, contact edits,
  CRM sync, API-key use), not just paid orders; the existing `health` pill; and a new **engagement
  level** — `activated` (has ordered and has contacts), `onboarding` (has contacts / an integration /
  scheduled sends but hasn't ordered), or `dormant` (signed up, did nothing). The five underlying
  signals are returned individually so the UI shows an activation checklist.
- **List enrichment.** The subscribers list gains a `recipientCount` column (one `groupBy`), and is
  relabelled **Customers** with clickable rows. The route path (`/admin/subscribers`) is unchanged to
  avoid churn; only the presentation is "Customers".

Health/paid-status/subscription-status constants and the `accountHealth` helper are exported from
`admin.service.ts` and reused, so the detail view and the list agree on what "active/at-risk/churned"
means.

## Alternatives considered

- **Per-customer event/activity log table.** A true timeline (every login, view, edit) would be
  richer, but needs new write paths across the app and a new table. The aggregate-on-read approach
  reuses data we already store and ships the 80% value now; a timeline can come later if needed.
- **Fold engagement into the list rows.** Rejected — computing full engagement per row is an N+1 on a
  100+ row list. The list carries only the cheap `recipientCount`; the expensive aggregation is
  per-customer, on demand.
- **Rename the route to `/admin/customers`.** Deferred — relabelling the UI to "Customers" delivers
  the intent without moving well-tested files or breaking the loading skeleton.

## Consequences

- Operators can open any customer and see, at a glance, whether they're actually using the product —
  contacts and how they were added, scheduled sends, integrations, team, spend, and returns — not
  just whether they pay.
- The engagement level makes activation risk visible: an `onboarding` or `dormant` paying customer is
  a churn signal the order-only view missed.
- New engagement surfaces added in future should extend `getCustomer` (and, if a signal is cheap and
  headline-worthy, the list) so the portal keeps tracking the whole product, not a snapshot of it.
