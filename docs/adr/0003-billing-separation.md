# ADR 0003 — Recurring plan billing and card-order billing are always separate

Status: accepted
Date: 2026-07-15

## Context

In the legacy system, a plan-subscription purchase and a batch card order both flow through the
same WooCommerce cart/subscription engine. Walking a real order in that system surfaced a
subscription showing a "£16.64 / day" next-payment figure — a strong sign the two billing
concerns (recurring plan revenue vs. one-off/wallet-funded card revenue) have become tangled in
one object.

## Decision

`Subscription` (a Stripe Subscription — recurring plan billing) and `BatchOrder` /
`WalletLedgerEntry` (a Stripe PaymentIntent or a wallet debit — card-order billing) are modelled
as separate entities in the schema, and must be processed through separate Stripe objects.
Neither the API nor Stripe should ever represent "buy a plan" and "buy N cards" as the same cart
or subscription.

## Alternatives considered

- **One unified "cart" object handling both plan purchase and card orders** (closer to the
  legacy pattern) — rejected as the direct cause of the observed anomaly, and because it makes
  proration, refunds, and plan-change logic ambiguous (which part of the cart does a refund
  apply to?).

## Consequences

- Plan changes (upgrade/downgrade/cancel) only ever touch `Subscription` + Stripe Subscriptions
  API, with no risk of accidentally affecting in-flight card orders.
- Card-order refunds only ever touch `BatchOrder`/`WalletLedgerEntry` + a Stripe PaymentIntent
  refund, with no risk of affecting the recurring plan.
- The wallet ledger stays a clean, append-only audit trail of card-order money movement only,
  never mixed with plan revenue.
