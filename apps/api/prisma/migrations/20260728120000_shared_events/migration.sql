-- AlterEnum
ALTER TYPE "OccasionSource" ADD VALUE 'shared_event';

-- AlterTable
ALTER TABLE "occasions" ADD COLUMN     "event_id" TEXT;

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "OccasionType" NOT NULL,
    "event_date" DATE NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "events_account_id_event_date_idx" ON "events"("account_id", "event_date");

-- CreateIndex
CREATE INDEX "occasions_event_id_idx" ON "occasions"("event_id");

-- AddForeignKey
ALTER TABLE "occasions" ADD CONSTRAINT "occasions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
