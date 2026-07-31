-- CreateEnum
CREATE TYPE "SupportAttachmentKind" AS ENUM ('image', 'video');

-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN     "diagnostics" JSONB;

-- CreateTable
CREATE TABLE "support_ticket_message_attachments" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "kind" "SupportAttachmentKind" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_ticket_message_attachments_message_id_idx" ON "support_ticket_message_attachments"("message_id");

-- AddForeignKey
ALTER TABLE "support_ticket_message_attachments" ADD CONSTRAINT "support_ticket_message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "support_ticket_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
