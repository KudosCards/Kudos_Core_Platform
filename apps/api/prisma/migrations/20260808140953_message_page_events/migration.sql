-- CreateEnum
CREATE TYPE "MessagePageEventType" AS ENUM ('viewed', 'cta_clicked', 'replied');

-- CreateTable
CREATE TABLE "message_page_events" (
    "id" TEXT NOT NULL,
    "message_page_link_id" TEXT NOT NULL,
    "message_page_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "type" "MessagePageEventType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_page_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_page_events_account_id_created_at_idx" ON "message_page_events"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "message_page_events_message_page_id_created_at_idx" ON "message_page_events"("message_page_id", "created_at");

-- CreateIndex
CREATE INDEX "message_page_events_created_at_idx" ON "message_page_events"("created_at");

-- AddForeignKey
ALTER TABLE "message_page_events" ADD CONSTRAINT "message_page_events_message_page_link_id_fkey" FOREIGN KEY ("message_page_link_id") REFERENCES "message_page_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
