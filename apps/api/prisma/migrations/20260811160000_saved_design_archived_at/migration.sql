-- Soft-delete marker for saved designs. A design referenced by a past order or an
-- approved occasion can't be hard-deleted (FK Restrict on order_recipients /
-- occasions), so "Delete" archives it out of the library instead. The gallery
-- filters to archived_at IS NULL.
ALTER TABLE "saved_designs" ADD COLUMN "archived_at" TIMESTAMP(3);
