# 0102 — VAT receipts for card buyers via Stripe-generated invoices

## Status

Accepted

## Context

Subscribers can already download VAT invoices — they come from Stripe's hosted
**billing portal** (`invoice_history`), and Stripe holds the company legal name,
address and VAT registration number, so those are valid VAT invoices with no
company data in our codebase. But **card-order buyers** (one-off card purchases,
including guests) had no downloadable VAT receipt: the card checkout was a
payment-mode Checkout Session that produced a bare charge, not an invoice.

We wanted a downloadable VAT receipt for card buyers, in the same "generated
PDF" shape subscribers get, without hand-rolling a VAT document (inventing or
duplicating the VAT number in code would risk producing an invalid or divergent
tax record).

## Decision

Let **Stripe generate the invoice** for card orders too, and surface its PDF.

1. **`invoice_creation` on the card-order Checkout Session.** The card + guest
   checkout sessions (`batch-orders.service`) now pass
   `invoice_creation: { enabled: true, invoice_data: { metadata: { batchOrderId } } }`.
   Stripe produces a finalized VAT invoice for each one-off purchase using the
   account's business/VAT settings — the _same_ source that makes subscriber
   invoices VAT invoices. The `batchOrderId` on the invoice metadata is the link
   back to our order.

2. **Capture it on the `invoice.paid` webhook.** That event carries the whole
   finalized invoice — including `invoice_pdf` and `hosted_invoice_url` — so
   there's no extra Stripe API round-trip. `handleInvoicePaid` reads
   `invoice.metadata.batchOrderId` and stores `stripeInvoiceId` + `receiptUrl`
   (hosted) + `receiptPdfUrl` (PDF) on the `BatchOrder` (`updateMany`, so an
   absent/unknown order is a safe no-op and the write is idempotent under
   at-least-once redelivery). Subscription invoices also emit `invoice.paid` but
   carry no `batchOrderId`, so they're ignored here (plan state stays driven by
   `customer.subscription.*`). Chosen over retrieving the invoice inside
   `checkout.session.completed` precisely because the event already has the PDF
   and needs no network call — which also keeps it testable against the e2e's
   real (non-mocked) Stripe SDK.

3. **Surface the download.** The order detail page shows a **VAT receipt →
   Download PDF** link (plus "View online" for the hosted invoice) whenever the
   URLs are present. Guests — who have no account or order page — receive the
   invoice/receipt by Stripe email (a Stripe dashboard setting, noted in the
   runbook).

4. **Schema.** `BatchOrder` gains `stripeInvoiceId` (unique), `receiptUrl`,
   `receiptPdfUrl` (all nullable), plus a migration. The `BatchOrder` shared type
   carries the two URLs so the web renders the link.

## Consequences

- Card buyers get a real VAT receipt (Stripe's generated invoice PDF), with the
  company/VAT details maintained in one place — the Stripe account — exactly as
  for subscribers. No VAT number lives in the repo.
- No new dependency and no bespoke PDF generator: "generated PDF file" is
  satisfied by Stripe's invoice PDF.
- **Wallet-paid orders** have no Stripe charge of their own (the money moved at
  wallet top-up), so they get no per-order invoice; `receiptUrl`/`receiptPdfUrl`
  stay null and the link doesn't render. Surfacing a VAT receipt for the wallet
  **top-up** itself is the natural follow-up (the same `invoice_creation` +
  `invoice.paid` pattern on the top-up session).
- Requires the Stripe account's business + VAT details to be set and the
  `invoice.paid` event enabled on the webhook endpoint — both documented in the
  go-live runbook (§2b/§2c).
