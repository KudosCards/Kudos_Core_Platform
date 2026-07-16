import { PrismaClient, type Prisma } from "@prisma/client";

const prisma = new PrismaClient();

function blankDocument(): Prisma.InputJsonValue {
  return {
    version: 1,
    pages: [
      { name: "front", elements: [] },
      { name: "inside-left", elements: [] },
      { name: "inside-right", elements: [] },
      { name: "back", elements: [] },
    ],
  };
}

function greetingDocument(text: string, color: string): Prisma.InputJsonValue {
  return {
    version: 1,
    pages: [
      {
        name: "front",
        elements: [
          {
            kind: "text",
            id: "headline",
            text,
            x: 60,
            y: 200,
            fontFamily: "Georgia",
            fontSize: 32,
            color,
          },
        ],
      },
      { name: "inside-left", elements: [] },
      {
        name: "inside-right",
        elements: [
          {
            kind: "text",
            id: "message",
            text: "Dear {name},\n\n",
            x: 40,
            y: 40,
            fontFamily: "Helvetica",
            fontSize: 16,
            color: "#1a1a1a",
          },
        ],
      },
      { name: "back", elements: [] },
    ],
  };
}

// Fixed (not randomly generated) so re-seeding is idempotent, but real v4
// UUIDs — class-validator's @IsUUID() rejects UUID-shaped-but-invalid values
// like "10000000-0000-0000-0000-000000000001" (wrong version/variant nibbles).
const CARD_DESIGN_TEMPLATES = [
  {
    id: "fd1e8f6a-11dd-419e-83f3-0da0a030decb",
    category: "birthday",
    name: "Classic Birthday",
    thumbnailUrl: "https://placehold.co/300x400/fde68a/78350f?text=Happy+Birthday",
    document: greetingDocument("Happy Birthday,\n{name}!", "#78350f"),
  },
  {
    id: "447c548d-0bb9-4fbd-81de-e129da049175",
    category: "achievement",
    name: "Congratulations",
    thumbnailUrl: "https://placehold.co/300x400/bbf7d0/14532d?text=Congratulations",
    document: greetingDocument("Congratulations,\n{name}!", "#14532d"),
  },
  {
    id: "a08c2180-cd91-4856-be06-5558f6a2aa82",
    category: "blank",
    name: "Blank Canvas",
    thumbnailUrl: "https://placehold.co/300x400/e5e7eb/374151?text=Blank",
    document: blankDocument(),
  },
];

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

  for (const template of CARD_DESIGN_TEMPLATES) {
    await prisma.cardDesign.upsert({
      where: { id: template.id },
      update: template,
      create: template,
    });
  }
  console.log(`Seeded ${CARD_DESIGN_TEMPLATES.length} card design templates`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
