# ADR 0018 — Guided first order ("Send this card")

Status: accepted
Date: 2026-07-22

## Context

The public card library (ADR 0017) gets a visitor to *design* their first card, but the journey
then stopped at the editor. To turn a signup into a paying customer they still had to discover the
fragmented send path themselves: create a recipient, create an occasion, approve it, add it to a
batch order, then check out — five back-office pages. Moonpig's equivalent is one screen: fill in
who it's for, pay, done.

We want that: straight from the editor, a **"Send this card"** flow that carries a freshly-designed
card all the way to a *sent* first order. The first win is deliberately **one card to one
recipient** (the fast dopamine hit), then a nudge to import the whole list so the calendar
automation takes over.

## Decision

**Reuse the money path, don't fork it.** A single new endpoint orchestrates the existing, tested
steps rather than inventing a parallel checkout:

`POST /batch-orders/quick-send` (body: saved design id + recipient name/address + postage class,
optional occasion type) does, in order:
1. Verifies the saved design belongs to the account.
2. Creates the recipient via `RecipientsService.create` — so the guided path is still audited and
   still honours the plan's recipient cap.
3. Creates a one-off occasion **already `approved`** with the design attached (`source:
   one_off_campaign`, `dispatchOption: asap`, `occasionType` default `bespoke_campaign`). The guided
   flow *is* the human decision the manual approve step represents, so there's nothing left to
   approve.
4. Hands off to the same `BatchOrdersService.create` the manual checkout uses, which prices the card
   (VAT-inclusive £1.50 + postage, minus any plan discount) and does the atomic `approved → queued`
   transition.

It returns the **draft** `BatchOrder` (with its real total). The web wizard then drives it through
the **existing** `POST /batch-orders/:id/checkout` → Stripe Checkout → the existing webhook →
fulfilment. No new payment code, no second pricing formula, no second fulfilment path.

**Web:** a "Send this card →" CTA in the editor leads to `/designs/[id]/send` — one screen with the
recipient/address form + postage choice + an order summary (estimated total; the exact total, with
discounts, is shown on Stripe's page). "Pay & send" calls quick-send then checkout and redirects to
Stripe. The success page gains a "do this once, never miss a birthday again" nudge to import the
list and open the calendar.

## Alternatives considered

- **A fully separate "single card" checkout** (its own pricing + Stripe + fulfilment). Rejected —
  it would duplicate the money path, the exact thing the batch-order model was built to avoid, and
  double the surface for pricing/fulfilment bugs.
- **An intermediate review step that persists a draft before payment.** Rejected for the first
  order — it leaves a dangling draft if the visitor abandons. Instead the summary is shown on the
  form (estimate), and the authoritative total is on Stripe's own page; the draft is only created at
  the moment of "Pay & send".

## Consequences

- Abandoning at Stripe leaves a `pending_payment` draft order (and its recipient) — recoverable from
  `/orders`, and Stripe's `cancel_url` already returns to `/batch-orders/cancelled`. Same behaviour
  as the existing manual checkout, so nothing new to reason about.
- `quick-send` creates a recipient every time (no dedupe against existing recipients). That's correct
  for the first-order case (empty account); a "send to an existing recipient" variant is a later
  addition, not this change.
- Payment is card-only (Stripe Checkout). Wallet pay-with-balance already exists for the manual flow
  and can be offered here later; a brand-new account has no balance, so card is the right default.
