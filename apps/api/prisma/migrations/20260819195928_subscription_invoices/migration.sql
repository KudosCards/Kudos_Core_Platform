-- CreateTable
CREATE TABLE "subscription_invoices" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "stripe_invoice_id" TEXT NOT NULL,
    "stripe_subscription_id" TEXT,
    "amount_paid_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "billing_reason" TEXT,
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3) NOT NULL,
    "hosted_invoice_url" TEXT,
    "invoice_pdf_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_invoices_stripe_invoice_id_key" ON "subscription_invoices"("stripe_invoice_id");

-- CreateIndex
CREATE INDEX "subscription_invoices_account_id_paid_at_idx" ON "subscription_invoices"("account_id", "paid_at");

-- CreateIndex
CREATE INDEX "subscription_invoices_paid_at_idx" ON "subscription_invoices"("paid_at");

-- AddForeignKey
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
