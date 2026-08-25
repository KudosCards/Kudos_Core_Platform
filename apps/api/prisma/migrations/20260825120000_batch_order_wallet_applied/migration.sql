-- How much of this order was paid from the account wallet, in pence.
--
-- Reserved (debited) when the Checkout Session is created rather than when the
-- payment settles: sizing the Stripe charge against a balance that two
-- concurrent checkouts could both read would let the second one overdraw. The
-- reservation is released back to the ledger on every path where the payment
-- never completes. See docs/adr/0169.
--
-- 0 for every existing order: none of them had a partial wallet payment, and a
-- fully wallet-paid order records that on `payment_method` instead.
ALTER TABLE "batch_orders"
  ADD COLUMN "wallet_applied_minor" INTEGER NOT NULL DEFAULT 0;
