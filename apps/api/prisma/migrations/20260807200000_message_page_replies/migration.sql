-- Message page replies (Phase 2, ADR 0132): a recipient's written reply posted
-- from the public page, tied to the scanned link so the sender knows which card
-- it came from.
CREATE TABLE "message_page_replies" (
    "id" TEXT NOT NULL,
    "message_page_link_id" TEXT NOT NULL,
    "sender_name" TEXT,
    "body" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_page_replies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "message_page_replies_message_page_link_id_idx" ON "message_page_replies"("message_page_link_id");

ALTER TABLE "message_page_replies"
  ADD CONSTRAINT "message_page_replies_message_page_link_id_fkey"
  FOREIGN KEY ("message_page_link_id") REFERENCES "message_page_links"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
