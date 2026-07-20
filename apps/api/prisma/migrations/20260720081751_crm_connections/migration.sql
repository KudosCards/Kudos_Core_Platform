-- CreateTable
CREATE TABLE "crm_connections" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "encrypted_api_key" TEXT NOT NULL,
    "field_mapping" JSONB,
    "sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMP(3),
    "last_sync_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_connections_account_id_provider_key" ON "crm_connections"("account_id", "provider");

-- AddForeignKey
ALTER TABLE "crm_connections" ADD CONSTRAINT "crm_connections_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

