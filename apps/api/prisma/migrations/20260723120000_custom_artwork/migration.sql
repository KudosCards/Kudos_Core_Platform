-- SavedDesign.cardDesignId becomes nullable: a member's own uploaded artwork
-- is a saved design with no catalog template behind it.
ALTER TABLE "saved_designs" ALTER COLUMN "card_design_id" DROP NOT NULL;

-- PlanEntitlement gains a custom-artwork feature gate (default off).
ALTER TABLE "plan_entitlements"
  ADD COLUMN "custom_artwork_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Enable custom artwork on the paid plans to match the seed, so existing
-- production entitlement rows are consistent without needing a reseed.
UPDATE "plan_entitlements" SET "custom_artwork_enabled" = true
  WHERE "plan_id" IN ('pro', 'centre');
