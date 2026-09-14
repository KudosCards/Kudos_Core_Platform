-- A card carries the artwork it was bought with.
--
-- `order_recipients` is the row that *is* one card, and it already freezes
-- where the card goes and what it cost — shipping address, postage class,
-- price. What it says was left as a foreign key to `saved_designs`, whose
-- document an account edits freely between sends. Every render path read it
-- live, so editing a design rewrote every order that had ever used it,
-- including cards already paid for.
--
-- See docs/order-artwork-plan.md.
ALTER TABLE "order_recipients" ADD COLUMN "document_snapshot" JSONB;

-- Backfill from the design each card currently points at. This stops the drift;
-- it does not undo it. There is no record of what a design used to say
-- (`saved_designs` has no version history), so a card whose design has already
-- moved on keeps today's content until someone corrects it deliberately.
UPDATE "order_recipients" o
SET "document_snapshot" = d."document"
FROM "saved_designs" d
WHERE d."id" = o."saved_design_id";

-- Required from here on. `saved_design_id` is NOT NULL with a foreign key, so
-- the UPDATE above reached every row; this fails loudly rather than quietly if
-- that ever stops being true.
ALTER TABLE "order_recipients" ALTER COLUMN "document_snapshot" SET NOT NULL;
