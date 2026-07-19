-- AlterTable
ALTER TABLE "recipients" ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "account_api_keys" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_api_keys_key_hash_key" ON "account_api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "account_api_keys_account_id_idx" ON "account_api_keys"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "recipients_account_id_source_external_id_key" ON "recipients"("account_id", "source", "external_id");

-- AddForeignKey
ALTER TABLE "account_api_keys" ADD CONSTRAINT "account_api_keys_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

