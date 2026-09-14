-- The artwork's own pixel size, measured when the catalog sync copies it.
--
-- A page background is drawn full-bleed and centre-cropped to the card's
-- 1:1.409, so a source of any other shape loses its edges — 29% of the width
-- for a square one. Nothing measured that anywhere, so "which of our designs
-- are being cut up" had no answer at all. See docs/card-artwork-crop-plan.md.
--
-- Nullable: every existing row predates the measurement, and a design whose
-- image cannot be read must stay unmeasured rather than claim a size.
ALTER TABLE "card_designs" ADD COLUMN "artwork_width" INTEGER;
ALTER TABLE "card_designs" ADD COLUMN "artwork_height" INTEGER;
