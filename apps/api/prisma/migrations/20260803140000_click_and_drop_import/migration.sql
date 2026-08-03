-- AlterTable: track each card's Click & Drop import (order id + last error) so
-- imports are idempotent and failures are retryable from the ops queue. See ADR 0095.
ALTER TABLE "fulfillment_jobs" ADD COLUMN     "click_and_drop_order_id" TEXT;
ALTER TABLE "fulfillment_jobs" ADD COLUMN     "click_and_drop_error" TEXT;
