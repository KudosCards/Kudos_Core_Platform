-- The message a standing order chose for one card.
--
-- Picked at approval rather than at send, for two reasons. It can be seen
-- before it is printed, and it cannot change under the customer between the
-- approval and the post — a pool edited on the Tuesday would otherwise silently
-- rewrite the card going out on the Wednesday.
--
-- Null for every card a person approved themselves, which is all of them today.

ALTER TABLE "occasions"
  ADD COLUMN "standing_order_message_id" TEXT;

-- ON DELETE SET NULL, deliberately unlike the design foreign key beside it,
-- which is RESTRICT. Rewriting a message pool is an ordinary thing for a
-- subscriber to do and must not be blocked by a card already approved; the card
-- then falls back to the design's own words rather than vanishing. A design
-- going missing is a card with no artwork, which is why that one blocks.
ALTER TABLE "occasions"
  ADD CONSTRAINT "occasions_standing_order_message_id_fkey"
  FOREIGN KEY ("standing_order_message_id") REFERENCES "standing_order_messages" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- The send path reads this per card, by occasion id, so no index is needed for
-- that. This one answers the other direction — "which cards is this message
-- on" — which the pool editor needs before it warns somebody that rewriting a
-- message changes cards already approved.
CREATE INDEX "occasions_standing_order_message_id_idx"
  ON "occasions" ("standing_order_message_id")
  WHERE "standing_order_message_id" IS NOT NULL;
