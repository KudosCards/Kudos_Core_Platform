# ADR 0022 — Dashboard "Let's get you set up" onboarding checklist

Status: accepted
Date: 2026-07-22

## Context

New accounts land on `/get-started` (the guided three-step setup), but the moment they click into
`/dashboard` that guidance disappears. The dashboard only showed a single "import your contacts"
banner while `recipientCount === 0`, so a user who imported one contact but never scheduled a card
or placed an order lost the thread — there was no persistent, on-the-home-screen nudge toward the
first purchase.

We want a checklist widget on the dashboard that mirrors the three steps of `/get-started` with
live completion state, and that stays until the user has genuinely finished onboarding: contacts
in, birthdays lined up, and a first order paid for.

## Decision

**Two new dashboard-summary signals.** `GET /accounts/me/summary` (`DashboardService.getSummary`,
`dashboardSummarySchema`) gains:

- `hasOccasions: boolean` — any occasion exists (birthdays are on the calendar). Cheap
  `findFirst … select id` existence check, added to the existing single `Promise.all` round-trip.
- `firstOrderPlaced: boolean` — a `BatchOrder` exists in status `paid`, `fulfilling`, or
  `completed`. This is the **"completed their first purchase"** milestone: `draft` and
  `pending_payment` are deliberately excluded because money hasn't moved yet.

**Dashboard widget.** `GetStartedChecklist` (server component, presentational — takes the three
summary fields as props) renders a three-item checklist:

1. **Add your contacts** — done when `recipientCount > 0`.
2. **Line up their birthdays** — done when `hasOccasions` (follows automatically from step 1 once a
   contact has a date of birth, since occasions are created eagerly on recipient add).
3. **Send your first card** — done when `firstOrderPlaced`.

Each incomplete step shows a coral CTA to the relevant page; done steps show a green tick and no
CTA. The widget renders a `{n} of 3 done` progress chip, and returns `null` once all three are
complete — so the dashboard reverts to its normal "what needs my attention" layout. This replaces
the old `needsSetup` single-banner.

## Alternatives considered

- **Track step 2 as a literal "viewed the calendar" page-visit flag.** Rejected — it needs new
  per-user state and a write on every calendar load, and "birthdays are lined up" (occasions exist)
  is the outcome that actually matters, not whether a page was opened.
- **Hide the widget purely on `firstOrderPlaced`.** Rejected in favour of requiring all three —
  matches the request ("completed their first purchase **and** gone through each of the three
  steps") and keeps nudging a half-Moonpig user (who bought a one-off card via `/cards` without
  ever importing a list) toward the core bulk value.
- **A full count for the two new signals.** Rejected — `findFirst` on an indexed `accountId` is
  cheaper than a count when all we need is existence.

## Consequences

- Additive API change: two new non-optional booleans on the summary. `dashboardSummarySchema` and
  the `DashboardService` return type stay in lockstep; the brand-new-account e2e test asserts both
  are `false`, and the recipients+occasion test asserts `hasOccasions` flips true while
  `firstOrderPlaced` stays false.
- Purely additive on the web side — no new route, no client state; the checklist is server-rendered
  from data the dashboard already fetches.
