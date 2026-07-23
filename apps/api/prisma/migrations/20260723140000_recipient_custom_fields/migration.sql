-- Recipients gain arbitrary key→value custom fields, usable as {key} merge
-- tokens on a card. Nullable JSON — null/absent means no custom fields.
ALTER TABLE "recipients" ADD COLUMN "custom_fields" JSONB;
