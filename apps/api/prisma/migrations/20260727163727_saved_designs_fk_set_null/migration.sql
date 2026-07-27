-- DropForeignKey
ALTER TABLE "saved_designs" DROP CONSTRAINT "saved_designs_card_design_id_fkey";

-- AddForeignKey
ALTER TABLE "saved_designs" ADD CONSTRAINT "saved_designs_card_design_id_fkey" FOREIGN KEY ("card_design_id") REFERENCES "card_designs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
