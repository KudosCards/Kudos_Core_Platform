-- Message Pages v2: split the 1:1 MessagePage↔OrderRecipient model into
-- account-owned MessagePage (content) + per-card MessagePageLink (QR/slug +
-- counters), preserving every existing slug so cards already in the post keep
-- resolving. See docs/adr/0132-message-pages-v2.md.

-- Enums --------------------------------------------------------------------
CREATE TYPE "MessagePageStatus" AS ENUM ('active', 'archived');
CREATE TYPE "MessagePageVideoType" AS ENUM ('none', 'embed', 'upload');
CREATE TYPE "MessagePageVideoProvider" AS ENUM ('youtube', 'vimeo', 'loom', 'google_drive');

-- Plan entitlement flag (paid plans only; seed sets the paid ones true) -----
ALTER TABLE "plan_entitlements"
  ADD COLUMN "message_pages_enabled" BOOLEAN NOT NULL DEFAULT false;

-- New per-card link table --------------------------------------------------
CREATE TABLE "message_page_links" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "message_page_id" TEXT NOT NULL,
  "order_recipient_id" TEXT,
  "view_count" INTEGER NOT NULL DEFAULT 0,
  "first_viewed_at" TIMESTAMP(3),
  "cta_click_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "message_page_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "message_page_links_slug_key" ON "message_page_links"("slug");
CREATE UNIQUE INDEX "message_page_links_order_recipient_id_key" ON "message_page_links"("order_recipient_id");
CREATE INDEX "message_page_links_message_page_id_idx" ON "message_page_links"("message_page_id");

-- Grow message_pages into the content table (nullable first for backfill) ---
ALTER TABLE "message_pages"
  ADD COLUMN "account_id" TEXT,
  ADD COLUMN "created_by_user_id" TEXT,
  ADD COLUMN "title" TEXT,
  ADD COLUMN "video_type" "MessagePageVideoType" NOT NULL DEFAULT 'none',
  ADD COLUMN "video_provider" "MessagePageVideoProvider",
  ADD COLUMN "cta_label" TEXT,
  ADD COLUMN "cta_url" TEXT,
  ADD COLUMN "allow_replies" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "recipient_name" TEXT,
  ADD COLUMN "status" "MessagePageStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN "updated_at" TIMESTAMP(3);

-- Backfill: one link per existing page, preserving slug + view_count --------
INSERT INTO "message_page_links"
  ("id", "slug", "message_page_id", "order_recipient_id", "view_count", "created_at")
SELECT gen_random_uuid(), mp."slug", mp."id", mp."order_recipient_id", mp."view_count", mp."created_at"
FROM "message_pages" mp;

-- Backfill content columns: account via order recipient → batch order; a
-- default title; and video_type=upload where a legacy direct-file video exists
-- (v1 only supported <video src>, so any existing url is an uploaded file).
UPDATE "message_pages" mp
SET "account_id" = bo."account_id",
    "title" = 'Your message',
    "updated_at" = mp."created_at",
    "video_type" = CASE
      WHEN mp."video_url" IS NOT NULL AND mp."video_url" <> '' THEN 'upload'::"MessagePageVideoType"
      ELSE 'none'::"MessagePageVideoType"
    END
FROM "order_recipients" orr
JOIN "batch_orders" bo ON bo."id" = orr."batch_order_id"
WHERE orr."id" = mp."order_recipient_id";

-- Enforce NOT NULL now the backfill has populated them ----------------------
ALTER TABLE "message_pages"
  ALTER COLUMN "account_id" SET NOT NULL,
  ALTER COLUMN "title" SET NOT NULL,
  ALTER COLUMN "updated_at" SET NOT NULL;

-- Drop the columns that have moved onto the link ----------------------------
DROP INDEX IF EXISTS "message_pages_slug_key";
DROP INDEX IF EXISTS "message_pages_order_recipient_id_key";
ALTER TABLE "message_pages"
  DROP CONSTRAINT IF EXISTS "message_pages_order_recipient_id_fkey";
ALTER TABLE "message_pages"
  DROP COLUMN "slug",
  DROP COLUMN "order_recipient_id",
  DROP COLUMN "view_count";

-- Indexes + foreign keys ----------------------------------------------------
CREATE INDEX "message_pages_account_id_idx" ON "message_pages"("account_id");

ALTER TABLE "message_pages"
  ADD CONSTRAINT "message_pages_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "message_page_links"
  ADD CONSTRAINT "message_page_links_message_page_id_fkey"
  FOREIGN KEY ("message_page_id") REFERENCES "message_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "message_page_links"
  ADD CONSTRAINT "message_page_links_order_recipient_id_fkey"
  FOREIGN KEY ("order_recipient_id") REFERENCES "order_recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
