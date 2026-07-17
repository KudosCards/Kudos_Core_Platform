-- Postage is charged per card, on top of the (VAT-inclusive) card price.
-- Record the per-card stamp cost on each order line.
ALTER TABLE "order_recipients" ADD COLUMN "postage_minor" INTEGER NOT NULL DEFAULT 0;
