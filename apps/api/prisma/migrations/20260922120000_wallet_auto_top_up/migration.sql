-- Automatic wallet top-up.
--
-- The wallet is the single ledger every order is paid from, and nothing watched
-- it: the first a customer learned the money had run out was that cards stopped
-- going. These columns are the standing instruction to keep it funded.
--
-- `auto_top_up_enabled` defaults to FALSE on purpose. Permission to charge a
-- stored card while nobody is watching is given, never inherited, so every
-- existing account starts switched off and behaves exactly as it does today.
--
-- The threshold and amount carry defaults so a customer switching it on has
-- sensible values rather than an empty form (£10 and £50). They are bounded in
-- the API, not here: a CHECK constraint would have to be migrated to change the
-- bounds, and the bounds are a product decision.
--
-- `auto_top_up_paused_at` / `_reason` are how a failed charge stops us
-- retrying a card that will not work. NOT NULL with a default rewrites no rows
-- on Postgres 11+; the two nullable columns add no rewrite either.
ALTER TABLE "accounts"
  ADD COLUMN "auto_top_up_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "auto_top_up_threshold_minor" INTEGER NOT NULL DEFAULT 1000,
  ADD COLUMN "auto_top_up_amount_minor" INTEGER NOT NULL DEFAULT 5000,
  ADD COLUMN "auto_top_up_paused_at" TIMESTAMP(3),
  ADD COLUMN "auto_top_up_paused_reason" TEXT;

-- The watch cron asks "which accounts have a standing instruction that is not
-- paused" every morning. Partial, because that is a small slice of the table
-- and the index should be too.
CREATE INDEX "accounts_auto_top_up_enabled_idx"
  ON "accounts" ("auto_top_up_enabled")
  WHERE "auto_top_up_enabled" = true;
