-- Enterprise "Contact us" leads: a sales enquiry captured from the public
-- pricing option, worked by ops from the admin portal. See ADR 0101.

-- CreateEnum
CREATE TYPE "EnterpriseEnquiryStatus" AS ENUM ('new', 'in_progress', 'closed');

-- CreateTable
CREATE TABLE "enterprise_enquiries" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organisation" TEXT NOT NULL,
    "phone" TEXT,
    "team_size" TEXT,
    "message" TEXT NOT NULL,
    "status" "EnterpriseEnquiryStatus" NOT NULL DEFAULT 'new',
    "handled_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enterprise_enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enterprise_enquiries_status_created_at_idx" ON "enterprise_enquiries"("status", "created_at");
