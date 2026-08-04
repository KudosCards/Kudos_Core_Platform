-- Segments (smart lists): a saved, live-resolving filter over the contact book.
-- See ADR 0105.
CREATE TABLE "segments" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "segments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "segments_account_id_name_key" ON "segments"("account_id", "name");
CREATE INDEX "segments_account_id_created_at_idx" ON "segments"("account_id", "created_at");

ALTER TABLE "segments" ADD CONSTRAINT "segments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
