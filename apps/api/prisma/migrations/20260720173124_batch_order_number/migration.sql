-- Human-friendly sequential order number (rendered as ORD-1035). The sequence
-- uses SERIAL's standard name so Prisma treats the column as a plain
-- autoincrement (no migration drift), but starts at 1000 so orders read
-- ORD-1000+. Adding the column with a volatile nextval default backfills every
-- existing row with its own sequential value.
CREATE SEQUENCE "batch_orders_order_number_seq" START WITH 1000;

ALTER TABLE "batch_orders"
  ADD COLUMN "order_number" INTEGER NOT NULL DEFAULT nextval('batch_orders_order_number_seq');

ALTER SEQUENCE "batch_orders_order_number_seq" OWNED BY "batch_orders"."order_number";

-- CreateIndex
CREATE UNIQUE INDEX "batch_orders_order_number_key" ON "batch_orders"("order_number");
