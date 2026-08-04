-- AlterTable: denormalise the occasion's dispatch date onto the fulfillment job
-- so the ops queue can sort/bucket by send-urgency without a join. See ADR 0108.
ALTER TABLE "fulfillment_jobs" ADD COLUMN     "due_date" DATE;

-- Backfill existing jobs from their occasion's dispatch date. Jobs whose order
-- recipient has no occasion (occasion_id IS NULL) keep due_date = NULL.
UPDATE "fulfillment_jobs" fj
SET "due_date" = o."dispatch_date"
FROM "order_recipients" r
JOIN "occasions" o ON o."id" = r."occasion_id"
WHERE r."id" = fj."order_recipient_id";

-- Swap the bare status index for the composite the queue actually scans on.
DROP INDEX "fulfillment_jobs_status_idx";
CREATE INDEX "fulfillment_jobs_status_due_date_idx" ON "fulfillment_jobs"("status", "due_date");
