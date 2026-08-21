-- Support attachments move from public URLs to private storage paths.
--
-- The bucket becomes private, so a stored URL stops resolving; reads mint a
-- short-lived signed URL from the path instead. Additive and reversible: `url`
-- is left in place so anything not backfilled below still renders, and is
-- dropped in a later migration once every row is confirmed to carry a path.
ALTER TABLE "support_ticket_message_attachments" ADD COLUMN "path" TEXT;

-- Backfill from the public URLs already stored. Every one of these was produced
-- by Supabase's getPublicUrl(), so the shape is known:
--   https://<project>/storage/v1/object/public/support-attachments/<path>
-- substring() returns NULL for anything that doesn't match, which leaves the
-- row on its legacy `url` rather than inventing a path that would 404.
UPDATE "support_ticket_message_attachments"
SET "path" = substring("url" FROM '/object/public/support-attachments/(.+)$')
WHERE "path" IS NULL;

-- New rows carry only a path: the bucket is private, so there is no public URL
-- worth storing. `url` stays for the legacy rows the backfill above couldn't
-- resolve, and is dropped once none remain.
ALTER TABLE "support_ticket_message_attachments" ALTER COLUMN "url" DROP NOT NULL;
