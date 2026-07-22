-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "reminder_emails_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "occasions" ADD COLUMN     "reminder_sent_at" TIMESTAMP(3);

