-- AlterTable: operator role + email
ALTER TABLE "platform_admins" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'ops';
ALTER TABLE "platform_admins" ADD COLUMN "email" TEXT;

-- Existing operators predate roles — grant them super_admin so nobody loses
-- team-management ability on upgrade.
UPDATE "platform_admins" SET "role" = 'super_admin';

-- CreateTable: email allow-list for onboarding new operators
CREATE TABLE "platform_admin_invites" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ops',
    "invited_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admin_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admin_invites_email_key" ON "platform_admin_invites"("email");
