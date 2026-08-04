# 0103 — VAT receipts for wallet top-ups

## Status

Accepted

## Context

ADR 0102 gave **card-order** buyers a downloadable VAT receipt via Stripe's
generated invoice. It explicitly left a gap: an order **paid from wallet
balance** creates no Stripe charge of its own (the money changed hands earlier,
at top-up), so it has no per-order invoice. The actual taxable purchase for a
wallet user is the **top-up** — and that had no receipt. This closes the gap.

## Decision

Give each wallet top-up its own Stripe-generated VAT invoice, surfaced on the
wallet page — the same mechanism as card orders, so Stripe stays the single
source of truth for VAT/company details.

1. **`invoice_creation` on the top-up Checkout Session** (`wallet.service`), so
   Stripe produces a VAT invoice for the payment.

2. **Capture at credit time, not via `invoice.paid`.** Unlike a `BatchOrder`
   (which exists in `pending_payment` before the webhook), the top-up **ledger
   entry is created lazily** inside `applyTopupFromSession`. There's no
   pre-existing row for an `invoice.paid` handler to update, and the two webhooks
   race — so instead we fetch the invoice (`fetchTopupReceipt`) at the moment we
   credit the balance and write its `stripeInvoiceId` + hosted URL + PDF URL onto
   the new ledger entry in the same create. This is race-free by construction.
   The lookup is **best-effort**: a failure (or a session with no invoice, e.g.
   older top-ups) just leaves the receipt unset and never blocks the credit; the
   Stripe email receipt is the backstop.

3. **Schema.** `WalletLedgerEntry` gains `stripeInvoiceId`, `receiptUrl`,
   `receiptPdfUrl` (all nullable, only ever set on `topup` entries) + a migration.
   The shared `WalletLedgerEntry` type carries the two URLs; the wallet page shows
   a **Download VAT receipt** link on any top-up that has one.

## Consequences

- Wallet users now get a VAT receipt for the money they actually pay (the
  top-up), completing the buyer-receipt story started in ADR 0102: card-paid
  orders → the order's invoice; wallet-paid orders → the top-up's invoice.
- One extra Stripe `invoices.retrieve` per top-up (an infrequent action, already
  inside a webhook handler) — the deliberate cost of capturing the PDF race-free
  rather than chasing `invoice.paid` ordering. Card orders keep the `invoice.paid`
  approach because their row always pre-exists.
- Additive schema only (`wallet_ledger_entries` columns + migration). Same Stripe
  prerequisites as ADR 0102 (business/VAT details set; the top-up already runs
  through Checkout) — no new webhook event needed, since capture is synchronous.
- Verified by a unit test over `fetchTopupReceipt` (present/absent/failed lookup);
  the credit path itself stays covered by the existing wallet e2e.
