-- Record the addresses Brevo refuses to deliver to.
--
-- Brevo accepts the API call for a blocklisted address, returns a message id
-- and drops the message, so today the failure is invisible from inside the
-- product. This table is where Brevo's webhook writes what it told us, one row
-- per address.
CREATE TYPE "EmailSuppressionReason" AS ENUM (
  'hard_bounce',
  'blocked',
  'invalid',
  'spam',
  'unsubscribed'
);

CREATE TABLE "email_suppressions" (
  "id"            TEXT NOT NULL,
  "email"         TEXT NOT NULL,
  "reason"        "EmailSuppressionReason" NOT NULL,
  "detail"        TEXT,
  "subject"       TEXT,
  "message_id"    TEXT,
  "occurred_at"   TIMESTAMP(3),
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cleared_at"    TIMESTAMP(3),
  "cleared_by"    TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);

-- One row per address. The webhook upserts on this.
CREATE UNIQUE INDEX "email_suppressions_email_key"
  ON "email_suppressions" ("email");

-- The ops list: currently-suppressed addresses, most recent first.
CREATE INDEX "email_suppressions_cleared_at_last_seen_at_idx"
  ON "email_suppressions" ("cleared_at", "last_seen_at");
