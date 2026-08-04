-- Renewal & anniversary as recurring occasion types, generated from per-recipient
-- key dates (annually-recurring anchors, like birthdays from the DOB). See ADR 0104.

-- AlterEnum: new recurring occasion types
ALTER TYPE "OccasionType" ADD VALUE 'renewal';
ALTER TYPE "OccasionType" ADD VALUE 'anniversary';

-- CreateEnum
CREATE TYPE "KeyDateType" AS ENUM ('renewal', 'anniversary');

-- CreateTable
CREATE TABLE "recipient_key_dates" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "type" "KeyDateType" NOT NULL,
    "date" DATE NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipient_key_dates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recipient_key_dates_account_id_idx" ON "recipient_key_dates"("account_id");
CREATE UNIQUE INDEX "recipient_key_dates_recipient_id_type_key" ON "recipient_key_dates"("recipient_id", "type");

-- AddForeignKey
ALTER TABLE "recipient_key_dates" ADD CONSTRAINT "recipient_key_dates_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
