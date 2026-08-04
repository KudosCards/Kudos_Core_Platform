-- AlterTable
ALTER TABLE "occasions" ADD COLUMN     "supersedes_occasion_id" TEXT;

-- AddForeignKey
ALTER TABLE "occasions" ADD CONSTRAINT "occasions_supersedes_occasion_id_fkey" FOREIGN KEY ("supersedes_occasion_id") REFERENCES "occasions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
