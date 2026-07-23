-- AlterTable
ALTER TABLE "accounts" ADD COLUMN "extra_seats" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "plan_entitlements" ADD COLUMN "included_seats" INTEGER NOT NULL DEFAULT 1;

-- Centre includes 3 seats; free/pro keep the default of 1.
UPDATE "plan_entitlements" SET "included_seats" = 3 WHERE "plan_id" = 'centre';
