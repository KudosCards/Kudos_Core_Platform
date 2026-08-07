-- Send-flow attach (ADR 0132): the message page a card chose, carried from order
-- creation to settlement, where it becomes this card's QR link.
ALTER TABLE "order_recipients" ADD COLUMN "message_page_id" TEXT;

ALTER TABLE "order_recipients"
  ADD CONSTRAINT "order_recipients_message_page_id_fkey"
  FOREIGN KEY ("message_page_id") REFERENCES "message_pages"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
