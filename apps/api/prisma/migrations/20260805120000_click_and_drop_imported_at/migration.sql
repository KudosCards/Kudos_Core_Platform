-- AlterTable: a precise "imported into Click & Drop" timestamp, distinct from
-- updated_at (which any later change would move). See ADR 0114.
ALTER TABLE "fulfillment_jobs" ADD COLUMN     "click_and_drop_imported_at" TIMESTAMP(3);

-- Backfill already-imported cards from updated_at — the best proxy we have for
-- when they were pushed. New imports get an exact timestamp from the sweep.
UPDATE "fulfillment_jobs"
SET "click_and_drop_imported_at" = "updated_at"
WHERE "click_and_drop_order_id" IS NOT NULL;
