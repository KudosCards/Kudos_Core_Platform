# ADR 0012 — Account wallet: top-up-and-spend balance backed by an append-only ledger

Status: accepted
Date: 2026-07-17

## Context

ADR 0008 deliberately deferred the wallet: Phase 3 shipped card-only checkout, and the schema
(`WalletLedgerEntry`, `PaymentMethod` enum) was scaffolded so the wallet could land later without
migrations. Phase 8 is that follow-up.

The business case is repeat ordering. A tuition centre sending cards every week does not want a
Stripe redirect and a card entry for every batch; they want to pre-load a balance once and spend it
instantly as occasions come up. This is also the foundation the auto-send automation (Phase 9)
needs — an unattended "send ahead of the occasion date" job can't bounce the user through a hosted
Stripe page, but it _can_ debit a wallet.

Two things had to be decided: how the balance is represented (so it can never silently drift or be
overdrawn), and how a wallet payment reuses the existing post-payment fulfillment path without
forking it.

## Decision

- **Append-only ledger, balance = SUM of entries.** `WalletLedgerEntry` rows are immutable;
  top-ups/refunds are positive `amountMinor`, charges are negative. The authoritative balance is
  `SUM(amountMinor)` over the account's entries — order-independent, and impossible to drift from
  the ledger because it _is_ the ledger. `balanceAfterMinor` is stored as a convenience snapshot
  (useful for a statement view) but is never the source of truth. See `WalletService.balanceOf`.
- **Serializable isolation for every balance-changing write.** Top-up credit and order debit both
  run inside a `Serializable` transaction with retry-on-P2034 (the same pattern
  `recipients.service` uses for cap enforcement). Two concurrent spends therefore cannot both read
  the old balance and overdraw — one serializes after the other and sees the debited balance.
- **Top-up funds arrive via Stripe, credited on webhook — never on redirect.** `POST /wallet/top-up`
  creates a Stripe Checkout Session (`mode: payment`) tagged `metadata.type = "wallet_topup"`. The
  balance is credited only when `checkout.session.completed` is verified server-side, idempotent on
  `reference = "topup:<sessionId>"` so Stripe's at-least-once redelivery can't double-credit. The
  browser returning from `success_url` never moves money.
- **Wallet payment reuses the shared fulfillment step.** The post-payment work (recipients →
  `queued`, a `FulfillmentJob` per card, each card's QR message page) was extracted from the Stripe
  webhook into `BatchOrdersService.settleFulfillment(tx, id)`. `WalletService.payOrder` debits the
  balance, flips the order `draft → paid` with a status-guarded `updateMany`, and calls the same
  `settleFulfillment` — all in one Serializable transaction. A wallet-paid order and a card-paid
  order are indistinguishable to fulfillment except for `BatchOrder.paymentMethod`.
- **Preset top-up amounts (£10 / £25 / £50) plus a custom field**, bounded £1–£1,000 per top-up
  (`TopUpDto`). Presets cover the common case; the bounds keep a fat-fingered or hostile amount out
  of Stripe.
- **No wallet refunds / withdrawals in this phase.** A charge can only be reversed by a `refund`
  ledger entry (the enum supports it), but there is no user-facing withdraw-to-card flow yet — same
  staging rationale as ADR 0008's "prove the charge path first".

## Alternatives considered

- **A stored `balanceMinor` column mutated in place.** Rejected: it can drift from the transaction
  history (any missed/duplicated write desyncs it), and it's exactly the kind of denormalised money
  field that caused reconciliation pain in the legacy WooCommerce system. Summing an append-only
  ledger cannot drift.
- **Crediting the wallet optimistically on the `success_url` redirect.** Rejected: the redirect is
  attacker-controllable and fires before Stripe has actually settled — the webhook is the only
  trustworthy signal that money moved.
- **Duplicating the fulfillment logic in `WalletService`.** Rejected: two copies of "what happens
  when an order is paid" would inevitably diverge. Extracting `settleFulfillment` keeps one
  definition shared by both payment paths.
- **Optimistic-locking the balance instead of Serializable.** Workable, but Serializable is already
  the established concurrency primitive in this codebase and reads more obviously correct for a
  money path; the retry cost is negligible at this volume.

## Consequences

- Balance is always reconstructable and auditable from the ledger alone; a support question ("why
  is my balance £X?") is answered by reading the entries.
- Overdraw and double-spend are prevented by the database's isolation guarantee, not by
  application-level check-then-write, which would be racy.
- Auto-send (Phase 9) has a payment method it can use without human interaction — debit the wallet,
  reusing `payOrder`'s exact debit-and-settle transaction.
- Adding refunds/withdrawals later is additive: a new `refund` entry type is already in the enum and
  the balance formula needs no change.
