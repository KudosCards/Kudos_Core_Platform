-- Explicit pool order.
--
-- Both pools were read `ORDER BY created_at`, and the designs are written with
-- a single createMany — so they share a timestamp and came back in whatever
-- order Postgres felt like. The design pick is positional, which made it a
-- card chosen by chance rather than by the rule.
--
-- Backfilled from the existing order so nobody's pool is reshuffled by this
-- migration: same order out, now written down.
ALTER TABLE "standing_order_designs" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "standing_order_messages" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

UPDATE "standing_order_designs" AS d
SET "position" = ordered.rank
FROM (
  SELECT "standing_order_id", "saved_design_id",
         ROW_NUMBER() OVER (PARTITION BY "standing_order_id" ORDER BY "created_at", "saved_design_id") - 1 AS rank
  FROM "standing_order_designs"
) AS ordered
WHERE d."standing_order_id" = ordered."standing_order_id"
  AND d."saved_design_id" = ordered."saved_design_id";

UPDATE "standing_order_messages" AS m
SET "position" = ordered.rank
FROM (
  SELECT "id",
         ROW_NUMBER() OVER (PARTITION BY "standing_order_id" ORDER BY "created_at", "id") - 1 AS rank
  FROM "standing_order_messages"
) AS ordered
WHERE m."id" = ordered."id";
