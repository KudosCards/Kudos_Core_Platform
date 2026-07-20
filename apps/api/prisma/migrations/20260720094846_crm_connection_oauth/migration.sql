-- AlterTable
ALTER TABLE "crm_connections" ADD COLUMN     "auth_type" TEXT NOT NULL DEFAULT 'api_key',
ADD COLUMN     "encrypted_access_token" TEXT,
ADD COLUMN     "encrypted_refresh_token" TEXT,
ADD COLUMN     "external_account_id" TEXT,
ADD COLUMN     "token_expires_at" TIMESTAMP(3),
ALTER COLUMN "encrypted_api_key" DROP NOT NULL;

