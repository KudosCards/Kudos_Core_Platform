-- Letting the catalog describe itself.
--
-- A card design carried a category, a name, a slug, a SKU and a thumbnail, and
-- nothing that said who it suits. So "pick a card that fits this person" had
-- nothing to read, and automatic sending picks from the customer's chosen pool
-- by a hash instead. These two columns are the beginning of an answer.
--
-- Both are NULLABLE on purpose, and null is not the same as "any". Null means
-- nobody has described this design yet; `any` means somebody looked and said it
-- suits everybody. A selection rule must be able to tell silence from a claim,
-- which it could not if the default were `any`.
--
-- Authored in Airtable beside the artwork (ADR 0011), so the sync carries them
-- and there is no second place to keep in step.

CREATE TYPE "CardAgeBand" AS ENUM ('any', 'child', 'teen', 'adult');
CREATE TYPE "CardTone" AS ENUM ('funny', 'warm', 'elegant', 'simple');

ALTER TABLE "card_designs"
  ADD COLUMN "age_band" "CardAgeBand",
  ADD COLUMN "tone" "CardTone";

-- The question the ops pass asks every morning is "which designs still have no
-- age band", over a catalog of a couple of hundred rows. Partial, because the
-- described rows are the ones this index should not carry.
CREATE INDEX "card_designs_undescribed_idx"
  ON "card_designs" ("category")
  WHERE "age_band" IS NULL;
