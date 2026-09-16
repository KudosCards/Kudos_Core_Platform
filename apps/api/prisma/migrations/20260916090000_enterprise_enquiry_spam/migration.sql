-- The public Enterprise form is @Public() by design (ADR 0101) and had no
-- honeypot, no timing check and no captcha, so bot form-fillers were reaching
-- the ops inbox. ADR 0101's promise is that a sales lead is never lost, so a
-- caught submission is classified rather than refused: the row is still
-- written, ops can restore it, and the bot gets the same 201 either way.
--
-- `spam_reason` records which rule caught it, so the filter is auditable by the
-- people it serves.
--
-- `IF NOT EXISTS` matches the existing precedent for enum additions here, so a
-- re-run is a no-op rather than an error. Nothing writes the new value inside
-- this transaction — Postgres will not let a newly added enum value be *used*
-- in the transaction that adds it — which is what keeps this a single file.
--
-- See ADR 0244 and docs/enterprise-spam-and-email-injection-plan.md.
ALTER TYPE "EnterpriseEnquiryStatus" ADD VALUE IF NOT EXISTS 'spam';

ALTER TABLE "enterprise_enquiries" ADD COLUMN "spam_reason" TEXT;
