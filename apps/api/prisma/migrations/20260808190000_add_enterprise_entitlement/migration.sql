-- Seed the Enterprise plan entitlement row.
--
-- Enterprise is the quote-based "Everything in Centre, plus…" tier
-- (ENTERPRISE_PLAN in shared-types): no Stripe object, provisioned by hand.
-- Without a plan_entitlements row, an account manually set to planId
-- 'enterprise' would 404 in EntitlementsService.getForAccount. This inserts a
-- full-access row so that never happens.
--
-- Production runs `prisma migrate deploy` only (never the seed), so this
-- mirrors the enterprise row added to prisma/seed.ts. Values match seed.ts:
-- unlimited recipients (NULL), effectively-unlimited seats, all feature flags
-- on, and cardDiscountPercent at Centre's 15% as a safe floor (ops set the
-- negotiated volume rate per deal). No Stripe price id.
--
-- ON CONFLICT DO NOTHING keeps this idempotent and, crucially, never
-- overwrites an enterprise row ops may have customised for a specific deal on
-- a later redeploy.
INSERT INTO "plan_entitlements" (
  "plan_id", "recipient_cap", "batch_order_max_size", "card_discount_percent",
  "auto_send_enabled", "custom_artwork_enabled", "team_seats_enabled",
  "included_seats", "message_pages_enabled", "stripe_price_id"
) VALUES (
  'enterprise', NULL, 5000, 15,
  true, true, true,
  999, true, NULL
)
ON CONFLICT ("plan_id") DO NOTHING;
