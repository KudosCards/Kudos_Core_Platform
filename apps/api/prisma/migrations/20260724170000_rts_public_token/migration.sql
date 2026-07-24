-- AlterTable
ALTER TABLE "return_cases" ADD COLUMN "public_token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "return_cases_public_token_key" ON "return_cases"("public_token");
