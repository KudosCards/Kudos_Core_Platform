-- How an account came into being, recorded rather than inferred.
--
-- Two paths create an account: a person registering, and a guest account minted
-- server-side mid-checkout so a one-off buyer has somewhere to put their card.
-- Telling them apart mattered the moment something decided to give money to
-- "new sign-ups", and it had stopped being inferable: a claim nulls both
-- claim_token and claim_token_expires_at and renames the account, so a claimed
-- guest looks exactly like a registration.
--
-- See docs/wallet-campaigns-plan.md.
CREATE TYPE "AccountOrigin" AS ENUM ('signup', 'guest');

-- Nullable first, so the backfill has somewhere to write before the column
-- becomes required.
ALTER TABLE "accounts" ADD COLUMN "origin" "AccountOrigin";

-- 1. An unclaimed guest still holds its token. Unambiguous.
UPDATE "accounts"
SET "origin" = 'guest'
WHERE "claim_token" IS NOT NULL OR "claim_token_expires_at" IS NOT NULL;

-- 2. No membership at all cannot be a registration: signup() creates the owner
--    membership in the same transaction as the account.
UPDATE "accounts" a
SET "origin" = 'guest'
WHERE a."origin" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "memberships" m WHERE m."account_id" = a."id");

-- 3. A *claimed* guest, which rules 1 and 2 cannot see. Its first order predates
--    its first membership, because guest checkout creates the order and the
--    claim creates the membership days later. A registration is the other way
--    round by construction — the membership exists before any order can.
UPDATE "accounts" a
SET "origin" = 'guest'
WHERE a."origin" IS NULL
  AND (
    SELECT MIN(o."created_at") FROM "batch_orders" o WHERE o."account_id" = a."id"
  ) < (
    SELECT MIN(m."created_at") FROM "memberships" m WHERE m."account_id" = a."id"
  );

-- 4. Everything left is a registration.
UPDATE "accounts" SET "origin" = 'signup' WHERE "origin" IS NULL;

-- Required from here on. Both creation paths must say which they are, and a
-- third fails to compile rather than inheriting whichever default happened to
-- suit the author.
ALTER TABLE "accounts" ALTER COLUMN "origin" SET NOT NULL;
