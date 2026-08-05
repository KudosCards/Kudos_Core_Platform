-- CreateTable: in-app notifications for the Kudos HQ ops team (platform-admin
-- equivalent of the account notification inbox). See ADR 0116.
CREATE TABLE "platform_notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "href" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: per-operator inbox list + unread badge, newest-first.
CREATE INDEX "platform_notifications_user_id_created_at_idx" ON "platform_notifications"("user_id", "created_at");

-- CreateIndex: idempotency lookup for producers (kind + entity).
CREATE INDEX "platform_notifications_kind_entity_id_idx" ON "platform_notifications"("kind", "entity_id");
