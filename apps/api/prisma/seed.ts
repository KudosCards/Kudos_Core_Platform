import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Mirrors the legacy site's three tiers (Free / Pro £9.97 / Centre £19.97).
 * Actual Stripe price wiring lands in Phase 3 — this seed only establishes
 * the entitlement limits these plan ids are checked against.
 */
const PLAN_ENTITLEMENTS = [
  { planId: "free", recipientCap: 50, batchOrderMaxSize: 20, cardDiscountPercent: 0, autoSendEnabled: false },
  { planId: "pro", recipientCap: 200, batchOrderMaxSize: 20, cardDiscountPercent: 10, autoSendEnabled: true },
  { planId: "centre", recipientCap: null, batchOrderMaxSize: 20, cardDiscountPercent: 15, autoSendEnabled: true },
];

async function main(): Promise<void> {
  for (const plan of PLAN_ENTITLEMENTS) {
    await prisma.planEntitlement.upsert({
      where: { planId: plan.planId },
      update: plan,
      create: plan,
    });
  }
  console.log(`Seeded ${PLAN_ENTITLEMENTS.length} plan entitlements`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
