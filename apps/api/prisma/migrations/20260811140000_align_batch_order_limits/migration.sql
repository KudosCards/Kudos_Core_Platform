-- Reconcile per-order bulk-order limits (plan_entitlements.batch_order_max_size)
-- with the subscription packages: free 10, pro 200, centre 500.
--
-- These already match prisma/seed.ts, but production runs `prisma migrate deploy`
-- only (never the seed), so rows seeded by an earlier version drifted — an
-- account was observed with a per-order cap of 20. This resets the three
-- standard plans to their intended caps. Enterprise (5000) is left untouched.
--
-- Idempotent: in dev/CI the seed already sets these values, so the UPDATEs are
-- no-ops; in production they correct the drift. Only affects plans that exist.
UPDATE "plan_entitlements" SET "batch_order_max_size" = 10  WHERE "plan_id" = 'free';
UPDATE "plan_entitlements" SET "batch_order_max_size" = 200 WHERE "plan_id" = 'pro';
UPDATE "plan_entitlements" SET "batch_order_max_size" = 500 WHERE "plan_id" = 'centre';
