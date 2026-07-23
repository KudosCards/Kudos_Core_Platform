# ADR 0035 — Seat-based billing for Centre teams

Status: accepted
Date: 2026-07-23

## Context

ADR 0028 gave the Centre plan multi-user teams, but seats were **unlimited** — one flat £19.97/mo
bought a team of any size. This ADR puts a priced limit on that. Confirmed with the user:

- **Centre includes 3 seats** (total members, owner included).
- **Each seat beyond 3 costs £5.00/month, VAT-inclusive.**
- **Hard-block** at the limit: inviting a 4th person is refused until a seat is added. No metered
  overage — schools run to fixed budgets, so a surprise charge is worse than a deliberate one.

## Decision

### What a "seat" is, and the limit

Seat **limit** = `PlanEntitlement.includedSeats` (Centre 3, single-user plans 1) + `Account.extraSeats`
(paid extras). Seat **usage** = active members + **pending invites** (a pending invite holds a seat
until it's accepted or revoked, so you can't over-invite and have them all accept). `Account.extraSeats`
is the local source of truth the invite guard reads — no Stripe call on the invite path.

### Hard-block on invite

`TeamService.createInvite` refuses once `usage >= limit`, with "add a seat to invite more." One
exception: **re-inviting an already-pending email is a resend, not a new seat**, so it's exempt (it
doesn't increase usage). Removing a member frees a seat immediately (they stop occupying it) but does
**not** reduce `extraSeats` — the customer keeps paying for the seat until they explicitly remove it,
which is the deliberate, no-surprise behaviour.

### Buying/removing seats — Stripe subscription quantity

`POST /subscriptions/seats { extraSeats }` (owner/admin only) sets the paid extra-seat count as an
**absolute target** (idempotent). It reflects that onto the Centre subscription's per-seat line item
via `stripe.subscriptions.update` with `proration_behavior: "create_prorations"` — updating an
existing seat item's quantity, adding one, or deleting it at zero — then mirrors the count onto
`Account.extraSeats`. It **can't cut below current usage** (409): remove members/invites first. The
per-seat Stripe Price is configured via `STRIPE_CENTRE_SEAT_PRICE_ID` (optional env — "add a seat"
returns a clean "not configured" until it's set).

### Webhook reconciliation

`customer.subscription.updated/created/deleted` now also syncs `Account.extraSeats` from the seat
line item's quantity (and zeroes it on cancellation, which also drops the plan to free). So a change
made by proration, in the Stripe dashboard, or by a failed renewal reconciles back to the local
source of truth — the API write and the webhook agree.

### Web

The Team page gains a **seat meter** ("Using X of Y seats", a usage bar, and the included/extra
breakdown), **Add a seat (£5.00/mo)** / **Remove a seat** controls for owners/admins, and an at-limit
banner on the invite form (with the submit button disabled) pointing at the meter.

## Alternatives considered

- **Metered overage** (invite always works, bill auto-bumps) — rejected by the user for the
  budget-conscious school audience; bill shock is the failure mode to avoid.
- **A `NotificationRead`-style separate seat-purchase record** — unnecessary; the Stripe subscription
  item *is* the billing record, and `Account.extraSeats` is the cheap local mirror.
- **Per-seat pricing with no included allowance** — would have been a price rise for existing Centre
  teams already using >1 seat; the "3 included + £5 extra" model leaves current small teams unchanged.

## Consequences

- Centre teams beyond 3 people now pay for what they use, deliberately, with no surprise charges.
- The invite guard reads one local integer, so the hot path stays a couple of cheap counts — no Stripe
  round-trip to invite.
- Stripe remains the billing source of truth; `Account.extraSeats` is a mirror kept honest from both
  the API write and the webhook.
- **Pre-deploy step:** a recurring £5.00/mo GBP Stripe Price must be created for the Centre product and
  its id set as `STRIPE_CENTRE_SEAT_PRICE_ID` (test-mode first, per the Phase-3 verification pattern),
  or "add a seat" stays disabled with a clean "not configured" message.
