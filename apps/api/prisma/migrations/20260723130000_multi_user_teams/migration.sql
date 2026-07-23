-- Membership gains a captured email so the team UI can show who's who.
ALTER TABLE "memberships" ADD COLUMN "email" TEXT;

-- Best-effort backfill for existing owner memberships from the account's
-- contact email (set at signup). Invited/legacy rows stay null until touched.
UPDATE "memberships" m
  SET "email" = a."contact_email"
  FROM "accounts" a
  WHERE m."account_id" = a."id"
    AND m."role" = 'owner'
    AND a."contact_email" IS NOT NULL;

-- PlanEntitlement gains the team-seats gate; enable it for Centre.
ALTER TABLE "plan_entitlements"
  ADD COLUMN "team_seats_enabled" BOOLEAN NOT NULL DEFAULT false;
UPDATE "plan_entitlements" SET "team_seats_enabled" = true WHERE "plan_id" = 'centre';

-- Team invitations.
CREATE TYPE "InviteStatus" AS ENUM ('pending', 'accepted', 'revoked');

CREATE TABLE "invites" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" "MembershipRole" NOT NULL,
  "token" TEXT NOT NULL,
  "status" "InviteStatus" NOT NULL DEFAULT 'pending',
  "invited_by_user_id" TEXT,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "accepted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invites_token_key" ON "invites"("token");
CREATE INDEX "invites_account_id_idx" ON "invites"("account_id");
CREATE UNIQUE INDEX "invites_account_id_email_key" ON "invites"("account_id", "email");

ALTER TABLE "invites" ADD CONSTRAINT "invites_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
