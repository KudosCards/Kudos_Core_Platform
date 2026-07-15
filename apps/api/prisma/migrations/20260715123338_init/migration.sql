-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('organisation', 'individual');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('owner', 'admin', 'staff');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('active', 'lapsed', 'archived');

-- CreateEnum
CREATE TYPE "OccasionType" AS ENUM ('birthday', 'achievement', 'leaver', 'staff_recognition', 'seasonal', 'bespoke_campaign');

-- CreateEnum
CREATE TYPE "OccasionSource" AS ENUM ('recurring_per_recipient', 'one_off_campaign');

-- CreateEnum
CREATE TYPE "OccasionStatus" AS ENUM ('scheduled', 'pending_approval', 'approved', 'queued', 'printed', 'posted', 'delivered', 'skipped');

-- CreateEnum
CREATE TYPE "BatchOrderStatus" AS ENUM ('draft', 'pending_payment', 'paid', 'fulfilling', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('card', 'wallet');

-- CreateEnum
CREATE TYPE "DispatchOption" AS ENUM ('asap', 'auto_send');

-- CreateEnum
CREATE TYPE "PostageClass" AS ENUM ('first_class', 'second_class');

-- CreateEnum
CREATE TYPE "OrderRecipientStatus" AS ENUM ('pending_approval', 'approved', 'queued', 'printed', 'posted', 'delivered', 'cancelled');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'canceled', 'incomplete');

-- CreateEnum
CREATE TYPE "WalletEntryType" AS ENUM ('topup', 'charge', 'refund', 'adjustment');

-- CreateEnum
CREATE TYPE "FulfillmentJobStatus" AS ENUM ('pending', 'in_progress', 'printed', 'posted', 'delivered', 'failed');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "name" TEXT NOT NULL,
    "stripe_customer_id" TEXT,
    "plan_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipients" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "date_of_birth" DATE,
    "email" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "address_city" TEXT,
    "address_postcode" TEXT,
    "address_country" TEXT DEFAULT 'GB',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "RecipientStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occasions" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "recipient_id" TEXT,
    "type" "OccasionType" NOT NULL,
    "source" "OccasionSource" NOT NULL,
    "occasion_date" DATE NOT NULL,
    "dispatch_date" DATE,
    "status" "OccasionStatus" NOT NULL DEFAULT 'scheduled',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "occasions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_designs" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "thumbnail_url" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "card_designs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_designs" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "card_design_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_designs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_orders" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "status" "BatchOrderStatus" NOT NULL DEFAULT 'draft',
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "subtotal_minor" INTEGER NOT NULL DEFAULT 0,
    "postage_minor" INTEGER NOT NULL DEFAULT 0,
    "total_minor" INTEGER NOT NULL DEFAULT 0,
    "payment_method" "PaymentMethod",
    "stripe_payment_intent_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_recipients" (
    "id" TEXT NOT NULL,
    "batch_order_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "occasion_id" TEXT,
    "saved_design_id" TEXT NOT NULL,
    "shipping_address_line1" TEXT NOT NULL,
    "shipping_address_line2" TEXT,
    "shipping_address_city" TEXT NOT NULL,
    "shipping_address_postcode" TEXT NOT NULL,
    "shipping_address_country" TEXT NOT NULL DEFAULT 'GB',
    "dispatchOption" "DispatchOption" NOT NULL,
    "postageClass" "PostageClass" NOT NULL,
    "price_minor" INTEGER NOT NULL,
    "status" "OrderRecipientStatus" NOT NULL DEFAULT 'pending_approval',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_pages" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "order_recipient_id" TEXT NOT NULL,
    "message" TEXT,
    "emoji" TEXT,
    "video_url" TEXT,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "stripe_subscription_id" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_ledger_entries" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "type" "WalletEntryType" NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "balance_after_minor" INTEGER NOT NULL,
    "reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_entitlements" (
    "plan_id" TEXT NOT NULL,
    "recipient_cap" INTEGER,
    "batch_order_max_size" INTEGER NOT NULL DEFAULT 20,
    "card_discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "auto_send_enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "plan_entitlements_pkey" PRIMARY KEY ("plan_id")
);

-- CreateTable
CREATE TABLE "fulfillment_jobs" (
    "id" TEXT NOT NULL,
    "order_recipient_id" TEXT NOT NULL,
    "status" "FulfillmentJobStatus" NOT NULL DEFAULT 'pending',
    "assigned_to_user_id" TEXT,
    "printed_at" TIMESTAMP(3),
    "posted_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "tracking_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fulfillment_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log_entries" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_stripe_customer_id_key" ON "accounts"("stripe_customer_id");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_account_id_user_id_key" ON "memberships"("account_id", "user_id");

-- CreateIndex
CREATE INDEX "recipients_account_id_status_idx" ON "recipients"("account_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "recipients_account_id_first_name_last_name_address_postcode_key" ON "recipients"("account_id", "first_name", "last_name", "address_postcode", "date_of_birth");

-- CreateIndex
CREATE INDEX "occasions_account_id_status_idx" ON "occasions"("account_id", "status");

-- CreateIndex
CREATE INDEX "occasions_dispatch_date_idx" ON "occasions"("dispatch_date");

-- CreateIndex
CREATE UNIQUE INDEX "occasions_recipient_id_type_occasion_date_key" ON "occasions"("recipient_id", "type", "occasion_date");

-- CreateIndex
CREATE INDEX "card_designs_category_is_active_idx" ON "card_designs"("category", "is_active");

-- CreateIndex
CREATE INDEX "saved_designs_account_id_idx" ON "saved_designs"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "batch_orders_stripe_payment_intent_id_key" ON "batch_orders"("stripe_payment_intent_id");

-- CreateIndex
CREATE INDEX "batch_orders_account_id_status_idx" ON "batch_orders"("account_id", "status");

-- CreateIndex
CREATE INDEX "order_recipients_batch_order_id_idx" ON "order_recipients"("batch_order_id");

-- CreateIndex
CREATE INDEX "order_recipients_recipient_id_idx" ON "order_recipients"("recipient_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_pages_slug_key" ON "message_pages"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "message_pages_order_recipient_id_key" ON "message_pages"("order_recipient_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_key" ON "subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_account_id_idx" ON "subscriptions"("account_id");

-- CreateIndex
CREATE INDEX "wallet_ledger_entries_account_id_created_at_idx" ON "wallet_ledger_entries"("account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "fulfillment_jobs_order_recipient_id_key" ON "fulfillment_jobs"("order_recipient_id");

-- CreateIndex
CREATE INDEX "fulfillment_jobs_status_idx" ON "fulfillment_jobs"("status");

-- CreateIndex
CREATE INDEX "audit_log_entries_account_id_created_at_idx" ON "audit_log_entries"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_entries_target_type_target_id_idx" ON "audit_log_entries"("target_type", "target_id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipients" ADD CONSTRAINT "recipients_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occasions" ADD CONSTRAINT "occasions_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_designs" ADD CONSTRAINT "saved_designs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_designs" ADD CONSTRAINT "saved_designs_card_design_id_fkey" FOREIGN KEY ("card_design_id") REFERENCES "card_designs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_orders" ADD CONSTRAINT "batch_orders_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_recipients" ADD CONSTRAINT "order_recipients_batch_order_id_fkey" FOREIGN KEY ("batch_order_id") REFERENCES "batch_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_recipients" ADD CONSTRAINT "order_recipients_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "recipients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_recipients" ADD CONSTRAINT "order_recipients_occasion_id_fkey" FOREIGN KEY ("occasion_id") REFERENCES "occasions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_recipients" ADD CONSTRAINT "order_recipients_saved_design_id_fkey" FOREIGN KEY ("saved_design_id") REFERENCES "saved_designs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_pages" ADD CONSTRAINT "message_pages_order_recipient_id_fkey" FOREIGN KEY ("order_recipient_id") REFERENCES "order_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_ledger_entries" ADD CONSTRAINT "wallet_ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fulfillment_jobs" ADD CONSTRAINT "fulfillment_jobs_order_recipient_id_fkey" FOREIGN KEY ("order_recipient_id") REFERENCES "order_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log_entries" ADD CONSTRAINT "audit_log_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
