-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('open', 'awaiting_customer', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "SupportTicketCategory" AS ENUM ('billing', 'orders', 'design', 'account', 'other');

-- CreateEnum
CREATE TYPE "SupportTicketPriority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "SupportMessageAuthor" AS ENUM ('customer', 'support');

-- Human-friendly sequential ticket number (rendered as TKT-1000). Uses SERIAL's
-- standard sequence name so Prisma treats the column as a plain autoincrement (no
-- migration drift), but starts at 1000 so tickets read TKT-1000+.
CREATE SEQUENCE "support_tickets_ticket_number_seq" START WITH 1000;

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "ticket_number" INTEGER NOT NULL DEFAULT nextval('support_tickets_ticket_number_seq'),
    "account_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "category" "SupportTicketCategory" NOT NULL DEFAULT 'other',
    "priority" "SupportTicketPriority" NOT NULL DEFAULT 'normal',
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'open',
    "assigned_to_user_id" TEXT,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_from" "SupportMessageAuthor" NOT NULL DEFAULT 'customer',
    "resolved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

ALTER SEQUENCE "support_tickets_ticket_number_seq" OWNED BY "support_tickets"."ticket_number";

-- CreateTable
CREATE TABLE "support_ticket_messages" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "author_type" "SupportMessageAuthor" NOT NULL,
    "author_user_id" TEXT,
    "body" TEXT NOT NULL,
    "internal_note" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_ticket_number_key" ON "support_tickets"("ticket_number");

-- CreateIndex
CREATE INDEX "support_tickets_account_id_created_at_idx" ON "support_tickets"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "support_tickets_status_last_message_at_idx" ON "support_tickets"("status", "last_message_at");

-- CreateIndex
CREATE INDEX "support_ticket_messages_ticket_id_created_at_idx" ON "support_ticket_messages"("ticket_id", "created_at");

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
