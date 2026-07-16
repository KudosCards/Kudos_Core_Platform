-- AlterTable
ALTER TABLE "occasions" ADD COLUMN     "saved_design_id" TEXT;

-- AddForeignKey
ALTER TABLE "occasions" ADD CONSTRAINT "occasions_saved_design_id_fkey" FOREIGN KEY ("saved_design_id") REFERENCES "saved_designs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
