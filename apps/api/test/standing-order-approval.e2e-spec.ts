import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import type Stripe from "stripe";
import { PrismaService } from "../src/prisma/prisma.service";
import { STRIPE_CLIENT } from "../src/billing/stripe-client.provider";
import { STANDING_ORDER_CONSENT_VERSION } from "../src/standing-orders/standing-order.consent";
import type { StandingOrderApprovalResult } from "../src/standing-orders/standing-order-approval.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/** Far enough out that the card is inside the approvals window but its dispatch
 * date is still ahead, so auto-send would not pick it up in the same breath. */
const BIRTHDAY_DAYS_AHEAD = 12;

describe("Standing order approval (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const mockStripe = { checkout: { sessions: { create: jest.fn() } } } as unknown as Stripe;
    app = await createTestApp([{ provide: STRIPE_CLIENT, useValue: mockStripe }]);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function proAccount(): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID());
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Centre ${randomUUID()}` })
      .expect(201);
    const accountId = accountSchema.parse(response.body).id;
    await prisma.account.update({ where: { id: accountId }, data: { planId: "pro" } });
    return { token, accountId };
  }

  async function opsToken(): Promise<string> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId } });
    return mintToken(userId);
  }

  function runApproval(bearer: string) {
    return request(app.getHttpServer())
      .post("/standing-order-approval/run")
      .set("Authorization", `Bearer ${bearer}`);
  }

  /**
   * A saved design from its own catalog template.
   *
   * `template` matters whenever a test describes designs: the age band lives on
   * the CardDesign, so two saved designs sharing one template share one
   * description, and the second `describeDesign` silently overwrites the first.
   */
  async function createSavedDesign(token: string, name: string, template = 0): Promise<string> {
    const templates = await request(app.getHttpServer())
      .get("/card-designs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const catalog = templates.body as { id: string }[];
    expect(catalog.length).toBeGreaterThan(template);
    const cardDesignId = catalog[template]!.id;
    const response = await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({ cardDesignId, name })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  /** A contact with a birthday `BIRTHDAY_DAYS_AHEAD` from today, and the
   * `pending_approval` birthday occasion that goes with it. */
  async function contactWithBirthday(
    token: string,
    accountId: string,
    firstName: string,
    options: { address?: boolean; age?: number } = {},
  ): Promise<{ recipientId: string; occasionId: string }> {
    const birthday = new Date();
    birthday.setUTCDate(birthday.getUTCDate() + BIRTHDAY_DAYS_AHEAD);
    // Their age on the birthday itself, so a test can ask for a seven-year-old
    // without doing the arithmetic at the call site.
    const birthYear = birthday.getUTCFullYear() - (options.age ?? 36);
    const dateOfBirth = new Date(
      Date.UTC(birthYear, birthday.getUTCMonth(), birthday.getUTCDate()),
    );

    const recipient = await prisma.recipient.create({
      data: {
        accountId,
        firstName,
        lastName: "Contact",
        dateOfBirth,
        ...(options.address === false
          ? {}
          : {
              addressLine1: "1 Test Street",
              addressCity: "London",
              addressPostcode: "SW1A 1AA",
            }),
      },
    });

    const occasionDate = new Date(
      Date.UTC(birthday.getUTCFullYear(), birthday.getUTCMonth(), birthday.getUTCDate()),
    );
    const occasion = await prisma.occasion.create({
      data: {
        accountId,
        recipientId: recipient.id,
        type: "birthday",
        source: "recurring_per_recipient",
        occasionDate,
        status: "pending_approval",
      },
    });
    void token;
    return { recipientId: recipient.id, occasionId: occasion.id };
  }

  /** Set the catalog attributes on the CardDesign a saved design came from —
   * what the ops pass fills in via Airtable (ADR 0259). */
  async function describeDesign(savedDesignId: string, ageBand: "any" | "child" | "adult") {
    const saved = await prisma.savedDesign.findUniqueOrThrow({
      where: { id: savedDesignId },
      select: { cardDesignId: true },
    });
    await prisma.cardDesign.update({
      where: { id: saved.cardDesignId! },
      data: { ageBand },
    });
  }

  async function createList(token: string, name: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/recipient-lists")
      .set("Authorization", `Bearer ${token}`)
      .send({ name })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  function saveOrder(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .put("/standing-order")
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  }

  /** A live instruction covering everybody, with one card and one message. */
  async function liveOrder(
    token: string,
    designIds: string[],
    overrides: Record<string, unknown> = {},
  ) {
    return saveOrder(token, {
      enabled: true,
      audience: { kind: "all" },
      postageClass: "second_class",
      savedDesignIds: designIds,
      messages: [{ text: "Happy birthday {firstName}." }],
      agreeToConsent: true,
      ...overrides,
    }).expect(200);
  }

  async function occasion(id: string) {
    return prisma.occasion.findUniqueOrThrow({ where: { id } });
  }

  it("approves a birthday nobody has touched, and queues it for auto-send", async () => {
    const { token, accountId } = await proAccount();
    const designId = await createSavedDesign(token, "Balloons");
    const { occasionId } = await contactWithBirthday(token, accountId, "Ada");
    await liveOrder(token, [designId]);

    const response = await runApproval(await opsToken()).expect(201);
    expect((response.body as StandingOrderApprovalResult).approved).toBeGreaterThanOrEqual(1);

    const after = await occasion(occasionId);
    expect(after.status).toBe("approved");
    expect(after.dispatchOption).toBe("auto_send");
    expect(after.savedDesignId).toBe(designId);
    expect(after.postageClass).toBe("second_class");
    // Re-timed to the postage class, exactly as the interactive approval does.
    expect(after.dispatchDate).not.toBeNull();
    expect(after.dispatchDate!.getTime()).toBeLessThan(after.occasionDate.getTime());
  });

  it("chooses a message from the pool and keeps it with the card", async () => {
    const { token, accountId } = await proAccount();
    const designId = await createSavedDesign(token, "Messaged");
    const { occasionId } = await contactWithBirthday(token, accountId, "Ada");
    await liveOrder(token, [designId], {
      messages: [{ text: "Happy birthday {firstName}, from all of us." }],
    });

    await runApproval(await opsToken()).expect(201);

    const after = await prisma.occasion.findUniqueOrThrow({
      where: { id: occasionId },
      include: { standingOrderMessage: true },
    });
    // Chosen at approval, not at send: it can be seen before it is printed, and
    // a pool edited tomorrow cannot silently rewrite a card going out today.
    expect(after.standingOrderMessage?.text).toBe("Happy birthday {firstName}, from all of us.");
  });

  it("prefers a card the catalog says suits the recipient's age", async () => {
    const { token, accountId } = await proAccount();
    const childDesign = await createSavedDesign(token, "For a child", 0);
    const adultDesign = await createSavedDesign(token, "For a grown-up", 1);
    await describeDesign(childDesign, "child");
    await describeDesign(adultDesign, "adult");

    const { occasionId } = await contactWithBirthday(token, accountId, "Small", { age: 7 });
    await liveOrder(token, [childDesign, adultDesign]);

    await runApproval(await opsToken()).expect(201);

    expect((await occasion(occasionId)).savedDesignId).toBe(childDesign);
  });

  it("does not guess an age it was never told", async () => {
    const { token, accountId } = await proAccount();
    const childDesign = await createSavedDesign(token, "For a child", 0);
    const anyDesign = await createSavedDesign(token, "For anybody", 1);
    await describeDesign(childDesign, "child");
    await describeDesign(anyDesign, "any");

    // A birthday with no year — every CleanCloud contact, by design.
    const { recipientId, occasionId } = await contactWithBirthday(token, accountId, "Unknown");
    await prisma.recipient.update({
      where: { id: recipientId },
      data: { birthYearKnown: false },
    });
    await liveOrder(token, [childDesign, anyDesign]);

    await runApproval(await opsToken()).expect(201);

    expect((await occasion(occasionId)).savedDesignId).toBe(anyDesign);
  });

  it("records the approval as the system's, not a person's", async () => {
    const { token, accountId } = await proAccount();
    const designId = await createSavedDesign(token, "Audited");
    const { occasionId } = await contactWithBirthday(token, accountId, "Grace");
    await liveOrder(token, [designId]);

    await runApproval(await opsToken()).expect(201);

    const entry = await prisma.auditLogEntry.findFirst({
      where: { accountId, action: "standing_order_approved", targetId: occasionId },
    });
    expect(entry).not.toBeNull();
    expect(entry!.actorUserId).toBe("system:standing-order");
  });

  it("leaves alone a card a person already decided about", async () => {
    const { token, accountId } = await proAccount();
    const designId = await createSavedDesign(token, "Skipped");
    const { occasionId } = await contactWithBirthday(token, accountId, "Joan");
    await liveOrder(token, [designId]);

    // They skipped it themselves this morning.
    await prisma.occasion.update({ where: { id: occasionId }, data: { status: "skipped" } });

    await runApproval(await opsToken()).expect(201);

    expect((await occasion(occasionId)).status).toBe("skipped");
  });

  it("does not reach outside the chosen list", async () => {
    const { token, accountId } = await proAccount();
    const designId = await createSavedDesign(token, "Listed");
    const inside = await contactWithBirthday(token, accountId, "Inside");
    const outside = await contactWithBirthday(token, accountId, "Outside");
    const listId = await createList(token, `Year 4 ${randomUUID()}`);
    await request(app.getHttpServer())
      .post(`/recipient-lists/${listId}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send({ recipientIds: [inside.recipientId] })
      .expect(201);

    await liveOrder(token, [designId], { audience: { kind: "list", listId } });
    await runApproval(await opsToken()).expect(201);

    expect((await occasion(inside.occasionId)).status).toBe("approved");
    // The whole promise of choosing a list is that the others are not in it.
    expect((await occasion(outside.occasionId)).status).toBe("pending_approval");
  });

  it("does nothing for an account that never set one up", async () => {
    const { token, accountId } = await proAccount();
    await createSavedDesign(token, "Unused");
    const { occasionId } = await contactWithBirthday(token, accountId, "Untouched");

    await runApproval(await opsToken()).expect(201);

    expect((await occasion(occasionId)).status).toBe("pending_approval");
  });

  it("does nothing while the instruction is switched off", async () => {
    const { token, accountId } = await proAccount();
    const designId = await createSavedDesign(token, "Off");
    const { occasionId } = await contactWithBirthday(token, accountId, "Waiting");
    await liveOrder(token, [designId], { enabled: false });

    await runApproval(await opsToken()).expect(201);

    expect((await occasion(occasionId)).status).toBe("pending_approval");
  });

  it("does nothing while nobody has agreed to the current wording", async () => {
    const { token, accountId } = await proAccount();
    const designId = await createSavedDesign(token, "Unconsented");
    const { occasionId } = await contactWithBirthday(token, accountId, "Unconsented");
    await liveOrder(token, [designId]);

    // They agreed to something we have since changed.
    await prisma.standingOrder.update({
      where: { accountId },
      data: { consentVersion: STANDING_ORDER_CONSENT_VERSION - 1 },
    });

    await runApproval(await opsToken()).expect(201);

    // Spending somebody's money on a permission they have not given is the one
    // thing this feature must never do.
    expect((await occasion(occasionId)).status).toBe("pending_approval");
  });

  it("does nothing once the plan no longer includes automatic sending", async () => {
    const { token, accountId } = await proAccount();
    const designId = await createSavedDesign(token, "Downgraded");
    const { occasionId } = await contactWithBirthday(token, accountId, "Downgraded");
    await liveOrder(token, [designId]);

    await prisma.account.update({ where: { id: accountId }, data: { planId: "free" } });

    await runApproval(await opsToken()).expect(201);

    expect((await occasion(occasionId)).status).toBe("pending_approval");
  });

  it("does nothing once the list it named was deleted", async () => {
    const { token, accountId } = await proAccount();
    const designId = await createSavedDesign(token, "Orphaned");
    const { recipientId, occasionId } = await contactWithBirthday(token, accountId, "Orphaned");
    const listId = await createList(token, `Doomed ${randomUUID()}`);
    await request(app.getHttpServer())
      .post(`/recipient-lists/${listId}/members`)
      .set("Authorization", `Bearer ${token}`)
      .send({ recipientIds: [recipientId] })
      .expect(201);
    await liveOrder(token, [designId], { audience: { kind: "list", listId } });

    await request(app.getHttpServer())
      .delete(`/recipient-lists/${listId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    await runApproval(await opsToken()).expect(201);

    // The foreign key is SET NULL, so the instruction now reads as "everybody".
    // Approving on that would post cards to every contact on the account.
    expect((await occasion(occasionId)).status).toBe("pending_approval");
  });

  it("does nothing once a chosen card has been archived", async () => {
    const { token, accountId } = await proAccount();
    const designId = await createSavedDesign(token, "Archived");
    const { occasionId } = await contactWithBirthday(token, accountId, "Archived");
    await liveOrder(token, [designId]);

    await request(app.getHttpServer())
      .delete(`/saved-designs/${designId}`)
      .set("Authorization", `Bearer ${token}`);

    await runApproval(await opsToken()).expect(201);

    expect((await occasion(occasionId)).status).toBe("pending_approval");
  });

  it("does not act on a smart-list audience", async () => {
    const { token, accountId } = await proAccount();
    const designId = await createSavedDesign(token, "Smart");
    const { occasionId } = await contactWithBirthday(token, accountId, "Smart");
    const segment = await prisma.segment.create({
      data: {
        accountId,
        name: `Smart ${randomUUID()}`,
        definition: { contact: {} },
      },
    });
    await liveOrder(token, [designId], {
      audience: { kind: "segment", segmentId: segment.id },
    });

    await runApproval(await opsToken()).expect(201);

    // A smart list is a rule, and an occasion-mode one carries a rolling date
    // window — so its membership moves on its own. Approving cards for whoever
    // it matched this morning is not a decision anybody made.
    expect((await occasion(occasionId)).status).toBe("pending_approval");
  });

  it("does not promote a birthday that is not yet in the approvals window", async () => {
    const { token, accountId } = await proAccount();
    const designId = await createSavedDesign(token, "Early");
    const { occasionId } = await contactWithBirthday(token, accountId, "Early");
    // Still months away, so the 06:00 scheduler has not promoted it.
    await prisma.occasion.update({ where: { id: occasionId }, data: { status: "scheduled" } });
    await liveOrder(token, [designId]);

    await runApproval(await opsToken()).expect(201);

    // Approving it here would post a card weeks before it is due.
    expect((await occasion(occasionId)).status).toBe("scheduled");
  });

  it("approves a card for a contact with no address, and lets auto-send report it", async () => {
    const { token, accountId } = await proAccount();
    const designId = await createSavedDesign(token, "Addressless");
    const { occasionId } = await contactWithBirthday(token, accountId, "Addressless", {
      address: false,
    });
    await liveOrder(token, [designId]);

    await runApproval(await opsToken()).expect(201);

    // Deliberately unlike the interactive approval, which refuses. There is no
    // human here to fix it on the spot, so the intent is accepted and the
    // missing address is surfaced by auto-send's own skip notice (ADR 0254) —
    // and the card goes the moment an address is added.
    expect((await occasion(occasionId)).status).toBe("approved");
  });

  it("approves birthdays and nothing else", async () => {
    const { token, accountId } = await proAccount();
    const designId = await createSavedDesign(token, "Birthdays only");
    const { recipientId, occasionId } = await contactWithBirthday(token, accountId, "Mixed");
    // Same contact, same window, a different kind of card. "Birthdays only for
    // now" was the answer, and an instruction that quietly covered leavers and
    // anniversaries too would be spending money on cards nobody asked for.
    const other = await prisma.occasion.create({
      data: {
        accountId,
        recipientId,
        type: "achievement",
        source: "recurring_per_recipient",
        title: "Graduation",
        occasionDate: (await occasion(occasionId)).occasionDate,
        status: "pending_approval",
      },
    });
    await liveOrder(token, [designId]);

    await runApproval(await opsToken()).expect(201);

    expect((await occasion(occasionId)).status).toBe("approved");
    expect((await occasion(other.id)).status).toBe("pending_approval");
  });

  it("leaves a shared event's cohort card to the person who set it up", async () => {
    const { token, accountId } = await proAccount();
    const designId = await createSavedDesign(token, "Cohort");
    const rolling = await contactWithBirthday(token, accountId, "Rolling");
    const cohort = await contactWithBirthday(token, accountId, "Cohort");
    // The same row shape, written by a different producer. The unique key is
    // (recipientId, type, occasionDate) with no source column, so this is how a
    // cohort card actually exists — one per member of the event.
    await prisma.occasion.update({
      where: { id: cohort.occasionId },
      data: { source: "shared_event" },
    });
    await liveOrder(token, [designId]);

    await runApproval(await opsToken()).expect(201);

    expect((await occasion(rolling.occasionId)).status).toBe("approved");
    // Somebody set that one up themselves and is waiting to approve it
    // themselves — with the design they chose for the whole cohort.
    expect((await occasion(cohort.occasionId)).status).toBe("pending_approval");
  });

  it("skips an archived contact", async () => {
    const { token, accountId } = await proAccount();
    const designId = await createSavedDesign(token, "Archived contact");
    const { recipientId, occasionId } = await contactWithBirthday(token, accountId, "Gone");
    await prisma.recipient.update({ where: { id: recipientId }, data: { status: "archived" } });
    await liveOrder(token, [designId]);

    await runApproval(await opsToken()).expect(201);

    expect((await occasion(occasionId)).status).toBe("pending_approval");
  });

  it("keeps one account's instruction off another's cards", async () => {
    const mine = await proAccount();
    const theirs = await proAccount();
    const designId = await createSavedDesign(mine.token, "Mine");
    const { occasionId } = await contactWithBirthday(theirs.token, theirs.accountId, "Theirs");
    await liveOrder(mine.token, [designId]);

    await runApproval(await opsToken()).expect(201);

    expect((await occasion(occasionId)).status).toBe("pending_approval");
  });

  it("forbids a non-admin from triggering a run", async () => {
    const { token } = await proAccount();
    await runApproval(token).expect(403);
  });
});
