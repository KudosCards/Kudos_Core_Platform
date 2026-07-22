-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "claim_token" TEXT,
ADD COLUMN     "claim_token_expires_at" TIMESTAMP(3),
ADD COLUMN     "contact_email" TEXT;

-- AlterTable
ALTER TABLE "batch_orders" ALTER COLUMN "created_by_user_id" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "accounts_claim_token_key" ON "accounts"("claim_token");

