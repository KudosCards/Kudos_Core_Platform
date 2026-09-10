-- A campaign's budget check aggregates every entry that campaign has issued,
-- looked up by `reference`, once per crediting attempt. Without this it is a
-- sequential scan of the whole ledger each time.
CREATE INDEX "wallet_ledger_entries_reference_idx" ON "wallet_ledger_entries"("reference");
