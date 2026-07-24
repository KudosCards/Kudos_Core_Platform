-- CreateEnum
CREATE TYPE "ReturnReason" AS ENUM ('moved', 'incomplete_address', 'incorrect_address', 'undeliverable', 'other');

-- CreateEnum
CREATE TYPE "ReturnCaseStatus" AS ENUM ('awaiting_address', 'awaiting_resend', 'resolved', 'archived');

-- AlterEnum
ALTER TYPE "FulfillmentJobStatus" ADD VALUE 'returned_to_sender';

-- AlterEnum
ALTER TYPE "OrderRecipientStatus" ADD VALUE 'returned_to_sender';

-- AlterTable
ALTER TABLE "recipients" ADD COLUMN     "address_verification_required" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "return_cases" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "order_recipient_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "reason" "ReturnReason" NOT NULL,
    "status" "ReturnCaseStatus" NOT NULL DEFAULT 'awaiting_address',
    "free_recovery_used" BOOLEAN NOT NULL DEFAULT false,
    "address_updated_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolution" TEXT,
    "recovery_order_id" TEXT,
    "marked_by_user_id" TEXT NOT NULL,
    "returned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "return_cases_order_recipient_id_key" ON "return_cases"("order_recipient_id");

-- CreateIndex
CREATE INDEX "return_cases_account_id_status_idx" ON "return_cases"("account_id", "status");

-- CreateIndex
CREATE INDEX "return_cases_status_returned_at_idx" ON "return_cases"("status", "returned_at");

-- AddForeignKey
ALTER TABLE "return_cases" ADD CONSTRAINT "return_cases_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_cases" ADD CONSTRAINT "return_cases_order_recipient_id_fkey" FOREIGN KEY ("order_recipient_id") REFERENCES "order_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_cases" ADD CONSTRAINT "return_cases_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
