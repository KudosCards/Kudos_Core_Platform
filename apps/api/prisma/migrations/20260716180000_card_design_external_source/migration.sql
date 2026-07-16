-- Airtable-sourced catalog: link each synced CardDesign back to its Airtable
-- record so the sync can upsert in place, and carry the human-facing SKU.
ALTER TABLE "card_designs" ADD COLUMN "external_id" TEXT;
ALTER TABLE "card_designs" ADD COLUMN "sku" TEXT;

CREATE UNIQUE INDEX "card_designs_external_id_key" ON "card_designs"("external_id");
