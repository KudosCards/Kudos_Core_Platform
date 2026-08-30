-- Bound the Returned-to-Sender recovery token, which had no expiry at all.
ALTER TABLE "return_cases" ADD COLUMN "public_token_expires_at" TIMESTAMP(3);

-- Backfill, rather than leaving existing tokens unbounded: those links are in
-- customers' inboxes right now and are exactly what this fixes. Dating the
-- expiry from when the case was created gives every token the same 30-day life
-- it would have had if the column had always existed — so a case opened last
-- week keeps working for another three weeks, and one from six months ago is
-- already dead, which is the correct answer for both.
UPDATE "return_cases"
   SET "public_token_expires_at" = "created_at" + INTERVAL '30 days'
 WHERE "public_token" IS NOT NULL;

-- A case that has already closed has no reason to keep a live credential.
-- Resolved and archived cases give their token up now; from here on the
-- application nulls it at the moment of closing.
UPDATE "return_cases"
   SET "public_token" = NULL, "public_token_expires_at" = NULL
 WHERE "public_token" IS NOT NULL
   AND "status" IN ('resolved', 'archived');
