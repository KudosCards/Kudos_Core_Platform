-- CreateTable
CREATE TABLE "design_assets" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "design_assets_account_id_created_at_idx" ON "design_assets"("account_id", "created_at");

-- AddForeignKey
ALTER TABLE "design_assets" ADD CONSTRAINT "design_assets_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
