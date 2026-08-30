-- Records which Stripe Checkout Session an order's CURRENT payment attempt
-- belongs to, so a webhook for a session the order has since superseded (a
-- resumed checkout) can be recognised as stale and ignored.
--
-- Nullable and NOT backfilled on purpose. Orders already sitting in
-- pending_payment when this lands have a live session we have no id for;
-- leaving them NULL makes the handlers fall back to the status guard alone —
-- exactly the behaviour they have today — so a checkout in flight across the
-- deploy still expires and releases normally. Every checkout after the deploy
-- writes the column, so the fleet self-heals within one session lifetime (24h).
ALTER TABLE "batch_orders" ADD COLUMN "stripe_checkout_session_id" TEXT;

CREATE UNIQUE INDEX "batch_orders_stripe_checkout_session_id_key"
  ON "batch_orders" ("stripe_checkout_session_id");
