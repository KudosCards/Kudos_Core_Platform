-- "Click and forget": the standing instruction, and the permission behind it.
--
-- Nothing here sends a card. This is the model and the consent; the rule that
-- picks a card and a message comes later, and so does automatic approval. Every
-- existing account gets no row at all, so the product behaves exactly as it
-- does today until somebody sets one up.

CREATE TYPE "StandingOrderMessageSource" AS ENUM ('written', 'assisted');

-- What the instruction was POINTED at, kept beside the id rather than inferred
-- from it. The foreign keys below are ON DELETE SET NULL, so without this a
-- deleted list reads exactly like a deliberate "everyone" — and the instruction
-- would quietly widen from one class of thirty children to every contact on the
-- account, draining the wallet on cards nobody asked for. With it, the widening
-- is detectable, and the API refuses to keep running until a person looks.
CREATE TYPE "StandingOrderAudienceKind" AS ENUM ('all', 'list', 'segment');

CREATE TABLE "standing_orders" (
  "id"                   TEXT NOT NULL,
  "account_id"           TEXT NOT NULL,
  "enabled"              BOOLEAN NOT NULL DEFAULT false,
  "audience_kind"        "StandingOrderAudienceKind" NOT NULL DEFAULT 'all',
  "recipient_list_id"    TEXT,
  "segment_id"           TEXT,
  "postage_class"        "PostageClass" NOT NULL DEFAULT 'second_class',
  "consented_by_user_id" TEXT,
  "consented_at"         TIMESTAMP(3),
  "consent_version"      INTEGER,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "standing_orders_pkey" PRIMARY KEY ("id")
);

-- One per account. The whole value of this feature is that it is a single
-- decision; a second instruction would immediately raise "which one wins for a
-- contact in both", and that is a question nobody wants to answer.
CREATE UNIQUE INDEX "standing_orders_account_id_key" ON "standing_orders" ("account_id");

-- A list OR a segment OR everyone — never a list and a segment at once. Written
-- as a constraint rather than left to the API because a row with both set has
-- no meaning, and a database that can hold a meaningless row eventually does.
ALTER TABLE "standing_orders"
  ADD CONSTRAINT "standing_orders_one_audience"
  CHECK ("recipient_list_id" IS NULL OR "segment_id" IS NULL);

-- The kind and the ids must agree on the way in. They are allowed to disagree
-- afterwards, and only in one direction: a SET NULL from a deleted target. That
-- asymmetry is the whole point — it is how "the list you chose is gone" is told
-- apart from "you chose everybody".
ALTER TABLE "standing_orders"
  ADD CONSTRAINT "standing_orders_audience_kind_matches"
  CHECK (
    ("audience_kind" = 'all' AND "recipient_list_id" IS NULL AND "segment_id" IS NULL)
    OR ("audience_kind" = 'list' AND "segment_id" IS NULL)
    OR ("audience_kind" = 'segment' AND "recipient_list_id" IS NULL)
  );

CREATE TABLE "standing_order_designs" (
  "standing_order_id" TEXT NOT NULL,
  "saved_design_id"   TEXT NOT NULL,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "standing_order_designs_pkey" PRIMARY KEY ("standing_order_id", "saved_design_id")
);

CREATE INDEX "standing_order_designs_saved_design_id_idx"
  ON "standing_order_designs" ("saved_design_id");

CREATE TABLE "standing_order_messages" (
  "id"                TEXT NOT NULL,
  "standing_order_id" TEXT NOT NULL,
  "text"              TEXT NOT NULL,
  "source"            "StandingOrderMessageSource" NOT NULL DEFAULT 'written',
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "standing_order_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "standing_order_messages_standing_order_id_idx"
  ON "standing_order_messages" ("standing_order_id");

ALTER TABLE "standing_orders"
  ADD CONSTRAINT "standing_orders_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not CASCADE: deleting the list an instruction points at must not
-- silently delete the instruction and the recorded consent with it. The target
-- falls back to "everyone", and the API refuses to leave it enabled on a
-- target the customer has not looked at since.
ALTER TABLE "standing_orders"
  ADD CONSTRAINT "standing_orders_recipient_list_id_fkey"
  FOREIGN KEY ("recipient_list_id") REFERENCES "recipient_lists" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "standing_orders"
  ADD CONSTRAINT "standing_orders_segment_id_fkey"
  FOREIGN KEY ("segment_id") REFERENCES "segments" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "standing_order_designs"
  ADD CONSTRAINT "standing_order_designs_standing_order_id_fkey"
  FOREIGN KEY ("standing_order_id") REFERENCES "standing_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT, not CASCADE, and the difference is the whole point.
--
-- "Delete a design" hard-deletes it when nothing references it and archives it
-- when something does (ADR 0158) — and the way it tells those apart is whether
-- Postgres raises a foreign-key violation. A CASCADE here would answer "nothing
-- references it" and silently narrow a pool the customer chose. RESTRICT makes
-- the pool count as the reference it is: the design is archived instead, the
-- pool row survives, and the API can tell them which card can no longer go.
ALTER TABLE "standing_order_designs"
  ADD CONSTRAINT "standing_order_designs_saved_design_id_fkey"
  FOREIGN KEY ("saved_design_id") REFERENCES "saved_designs" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "standing_order_messages"
  ADD CONSTRAINT "standing_order_messages_standing_order_id_fkey"
  FOREIGN KEY ("standing_order_id") REFERENCES "standing_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
