-- Wallet campaigns: credit every new account signing up inside a window.
--
-- No grants table on purpose. A campaign's grants are the wallet_ledger_entries
-- rows carrying `reference = 'campaign:<id>'`, so "how many accounts, how much
-- spent" is one aggregate over the same rows that produced the balances — the
-- count can never disagree with the money. See docs/wallet-campaigns-plan.md.
CREATE TYPE "WalletCampaignStatus" AS ENUM ('draft', 'live', 'paused', 'exhausted', 'ended');

CREATE TABLE "wallet_campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    -- UTC instants. An operator picks London dates and the creating edge
    -- converts once, so every later comparison is a plain timestamp comparison.
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "budget_minor" INTEGER NOT NULL,
    "status" "WalletCampaignStatus" NOT NULL DEFAULT 'draft',
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_campaigns_pkey" PRIMARY KEY ("id")
);

-- The sweep's own query: live campaigns whose window is open.
CREATE INDEX "wallet_campaigns_status_starts_at_idx" ON "wallet_campaigns"("status", "starts_at");
