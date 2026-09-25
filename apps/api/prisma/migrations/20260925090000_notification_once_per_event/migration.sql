-- One notification per person per event.
--
-- The application deduped with a read followed by a write, which two concurrent
-- producers both pass before either commits, so the same event could be
-- recorded twice and the once-per-event email sent twice.
--
-- Existing duplicates are collapsed first, keeping the earliest row — that is
-- the one the customer was actually told about, and its id may already be
-- referenced by a read receipt.
DELETE FROM "notifications" a
USING "notifications" b
WHERE a."entity_id" IS NOT NULL
  AND a."account_id" = b."account_id"
  AND a."user_id"    = b."user_id"
  AND a."kind"       = b."kind"
  AND a."entity_id"  = b."entity_id"
  AND (a."created_at" > b."created_at"
       OR (a."created_at" = b."created_at" AND a."id" > b."id"));

CREATE UNIQUE INDEX "notifications_account_id_user_id_kind_entity_id_key"
  ON "notifications" ("account_id", "user_id", "kind", "entity_id");
