# ADR 0019 — Guided onboarding: choose a plan → upload your contacts

Status: accepted
Date: 2026-07-22

## Context

ADR 0017/0018 built the consumer-style path (browse → personalise → sign up → send one card).
But Kudos' real value is **bulk, hyper-personalised cards to a whole list** — a tuition centre's
class, a club's members. For that audience the single highest-leverage first action isn't sending
one card; it's **getting their contact list in**, because that's what fills the calendar and makes
every downstream feature (birthdays, auto-send, bulk approval) work.

So the plan/subscription selection should mirror the card flow — each option leads into a guided
experience — but the guided experience's hero is **uploading the contact list**, not sending a
card.

## Decision

**A guided setup at `/get-started`, led by contact upload, is the default landing for new
subscribers.**

- **`/get-started`** (authenticated) is a three-step checklist:
  1. **Upload your contact list** (the priority) — CSV import (reuses `POST /recipients/import`),
     a downloadable template, and an "add one by hand" fallback. It reflects progress: once the
     account has contacts the step shows done, with a live count and a pointer to the calendar.
  2. **See your birthday calendar** — the payoff; every imported DOB is already scheduled.
  3. **Design & send a card** — into the public `/cards` library / send flow.
- **Every new sign-up lands on `/get-started`** (register + onboarding), *unless* they arrived via
  "Personalise this card" (they finish in the editor via `/start`, ADR 0017). The empty-state
  dashboard also links back to it.
- **Plan choice carries through.** Picking Pro/Centre on the marketing plans section goes to
  `/register?plan=…`; the choice is stashed (`kudos:pendingPlan`, localStorage, mirroring
  `pending-card`) and surfaced on `/get-started` as an **"Activate your {plan}"** CTA that runs the
  existing `POST /subscriptions/checkout` → Stripe. Free needs no activation. The billing page also
  links into `/get-started`.

**Value before payment.** Activating a paid plan is offered but never blocks contact upload — a new
subscriber can import their list, see the calendar light up, and *then* pay. Getting to the "aha"
first is the point.

## Alternatives considered

- **Force the Stripe subscription immediately on plan selection, before setup.** Rejected — paying
  before seeing any value is exactly the friction that kills B2B trials. The plan is remembered and
  offered inside the guided setup instead.
- **A blocking multi-step wizard.** Rejected in favour of a skippable checklist — the "skip to
  dashboard" escape hatch keeps it from feeling like a wall, while post-signup routing + the
  dashboard empty-state nudge keep it discoverable.
- **Carrying the plan only via the URL param.** Rejected as the sole mechanism: email confirmation
  can happen in a different tab and drop the param, so localStorage is the durable carrier (param is
  still read by `register`).

## Consequences

- No API changes — the guided setup orchestrates existing endpoints (`/recipients/import`,
  `/recipients`, `/recipients` count, `/subscriptions/checkout`). All already tested.
- Activating a paid plan depends on the plan's Stripe price being configured (same dependency as the
  billing page today); an unconfigured plan surfaces the API's existing "not yet configured" error.
- Two post-signup destinations now exist by intent: `/start` (came to personalise a card) and
  `/get-started` (everyone else). The pending-card check picks between them.
