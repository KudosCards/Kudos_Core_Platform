-- Composite indexes for the hot per-account list endpoints. Each matches a
-- `where account_id [+ range] order by <col>` query exactly, so Postgres can
-- serve the page from an index scan in sorted order instead of filtering by
-- account and then sorting. See docs/adr/0046-list-query-indexes.md.

-- Customer orders list: where account_id order by created_at desc.
CREATE INDEX "batch_orders_account_id_created_at_idx" ON "batch_orders"("account_id", "created_at");

-- Calendar: where account_id and occasion_date between from..to order by occasion_date.
CREATE INDEX "occasions_account_id_occasion_date_idx" ON "occasions"("account_id", "occasion_date");

-- Recipients list: where account_id order by created_at desc.
CREATE INDEX "recipients_account_id_created_at_idx" ON "recipients"("account_id", "created_at");
