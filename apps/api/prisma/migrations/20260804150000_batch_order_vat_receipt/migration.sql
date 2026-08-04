-- VAT receipts for card orders: capture Stripe's generated invoice (id + hosted
-- URL + PDF URL) so buyers can download a VAT receipt, mirroring how subscriber
-- invoices come from Stripe. Set from the invoice.paid webhook. See ADR 0102.
ALTER TABLE "batch_orders" ADD COLUMN "stripe_invoice_id" TEXT;
ALTER TABLE "batch_orders" ADD COLUMN "receipt_url" TEXT;
ALTER TABLE "batch_orders" ADD COLUMN "receipt_pdf_url" TEXT;

CREATE UNIQUE INDEX "batch_orders_stripe_invoice_id_key" ON "batch_orders"("stripe_invoice_id");
