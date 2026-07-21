-- CreateTable
CREATE TABLE "recipient_lists" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipient_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipient_list_memberships" (
    "list_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipient_list_memberships_pkey" PRIMARY KEY ("list_id","recipient_id")
);

-- CreateIndex
CREATE INDEX "recipient_lists_account_id_idx" ON "recipient_lists"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "recipient_lists_account_id_name_key" ON "recipient_lists"("account_id", "name");

-- CreateIndex
CREATE INDEX "recipient_list_memberships_recipient_id_idx" ON "recipient_list_memberships"("recipient_id");

-- AddForeignKey
ALTER TABLE "recipient_lists" ADD CONSTRAINT "recipient_lists_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipient_list_memberships" ADD CONSTRAINT "recipient_list_memberships_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "recipient_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipient_list_memberships" ADD CONSTRAINT "recipient_list_memberships_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "recipients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

