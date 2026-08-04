-- VAT receipts for wallet top-ups: capture Stripe's generated invoice (id +
-- hosted URL + PDF URL) on the topup ledger entry, mirroring card-order
-- receipts. Set when the top-up is credited. See ADR 0103.
ALTER TABLE "wallet_ledger_entries" ADD COLUMN "stripe_invoice_id" TEXT;
ALTER TABLE "wallet_ledger_entries" ADD COLUMN "receipt_url" TEXT;
ALTER TABLE "wallet_ledger_entries" ADD COLUMN "receipt_pdf_url" TEXT;
