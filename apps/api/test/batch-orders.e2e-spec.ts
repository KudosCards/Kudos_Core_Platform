import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import {
  accountSchema,
  computeDispatchDate,
  POSTAGE_LEAD_DAYS,
  startOfUtcDay,
  type BatchOrderPreflight,
} from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import type Stripe from "stripe";
import { z } from "zod";
import { PrismaService } from "../src/prisma/prisma.service";
import { STRIPE_CLIENT } from "../src/billing/stripe-client.provider";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

const orderRecipientSchema = z.object({
  id: z.string().uuid(),
  batchOrderId: z.string().uuid(),
  recipientId: z.string().uuid(),
  occasionId: z.string().uuid().nullable(),
  savedDesignId: z.string().uuid(),
  shippingAddressPostcode: z.string(),
  dispatchOption: z.string(),
  postageClass: z.string(),
  priceMinor: z.number(),
  postageMinor: z.number(),
  status: z.string(),
});

const batchOrderSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  status: z.string(),
  subtotalMinor: z.number(),
  postageMinor: z.number(),
  totalMinor: z.number(),
  paymentMethod: z.string().nullable(),
  orderRecipients: z.array(orderRecipientSchema),
});

/** The list row: a summary, deliberately without the cards. Declared here
 * independently of shared-types so a change to the shipped shape has to be made
 * in two places on purpose, rather than silently agreeing with itself. */
const batchOrderListRowSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  status: z.string(),
  subtotalMinor: z.number(),
  postageMinor: z.number(),
  totalMinor: z.number(),
  paymentMethod: z.string().nullable(),
  cardCount: z.number(),
  cardStatusCounts: z.record(z.string(), z.number()),
  sendSchedule: z.object({
    dateCount: z.number(),
    toCome: z.number(),
    gone: z.number(),
    undated: z.number(),
    earliest: z.string().nullable(),
    latest: z.string().nullable(),
    isSpread: z.boolean(),
  }),
});

const paginatedBatchOrdersSchema = z.object({
  items: z.array(batchOrderListRowSchema),
  total: z.number(),
});

function buildLine(occasionId: string) {
  return {
    occasionId,
    shippingAddressLine1: "1 Test Street",
    shippingAddressCity: "London",
    shippingAddressPostcode: "SW1A 1AA",
    dispatchOption: "asap",
    postageClass: "first_class",
  };
}

describe("Batch orders (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let checkoutSessionsCreate: jest.Mock;
  let refundsCreate: jest.Mock;

  beforeAll(async () => {
    checkoutSessionsCreate = jest.fn();
    refundsCreate = jest.fn();
    const mockStripe = {
      checkout: { sessions: { create: checkoutSessionsCreate } },
      refunds: { create: refundsCreate },
    } as unknown as Stripe;

    app = await createTestApp([{ provide: STRIPE_CLIENT, useValue: mockStripe }]);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    checkoutSessionsCreate.mockReset();
    refundsCreate.mockReset();
    refundsCreate.mockImplementation(() =>
      Promise.resolve({ id: `re_test_${randomUUID()}`, status: "succeeded" }),
    );
    // A fresh id per call: BatchOrder.stripePaymentIntentId is unique in the
    // DB, and a static mock value would collide across test cases the way
    // two genuinely distinct Stripe sessions never would in production.
    checkoutSessionsCreate.mockImplementation(() => {
      const id = randomUUID();
      return Promise.resolve({
        id: `cs_test_${id}`,
        url: `https://checkout.stripe.test/pay/cs_test_${id}`,
        payment_intent: `pi_test_${id}`,
      });
    });
  });

  /** A super-admin token — the re-date repair is ops-only. */
  async function opsToken(): Promise<string> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({
      data: { userId, role: "super_admin", email: `ops-${userId}@kudoscards.co.uk` },
    });
    return mintToken(userId);
  }

  async function signUp(): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID());
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Test Centre ${randomUUID()}` })
      .expect(201);
    return { token, accountId: accountSchema.parse(response.body).id };
  }

  async function createRecipient(token: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Sam",
        lastName: "Recipient",
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
      })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  async function createSavedDesign(token: string): Promise<string> {
    const templatesResponse = await request(app.getHttpServer())
      .get("/card-designs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const cardDesignId = (templatesResponse.body as { id: string }[])[0]!.id;
    const response = await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({ cardDesignId, name: "Test design" })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  /** Creates a recipient-linked occasion and approves it, ready for checkout. */
  async function createApprovedOccasion(token: string): Promise<string> {
    const recipientId = await createRecipient(token);
    const savedDesignId = await createSavedDesign(token);
    const createResponse = await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "achievement", occasionDate: "2026-09-01", recipientId })
      .expect(201);
    const occasionId = (createResponse.body as { id: string }).id;

    await request(app.getHttpServer())
      .post(`/occasions/${occasionId}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ savedDesignId })
      .expect(201);
    return occasionId;
  }

  it("creates a draft batch order from an approved occasion and prices it at the flat rate", async () => {
    const { token } = await signUp();
    const occasionId = await createApprovedOccasion(token);

    const response = await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [buildLine(occasionId)] })
      .expect(201);
    const order = batchOrderSchema.parse(response.body);

    expect(order.status).toBe("draft");
    // One first-class card: £2.50 card + £1.80 stamp = £4.30.
    expect(order.subtotalMinor).toBe(250);
    expect(order.postageMinor).toBe(180);
    expect(order.totalMinor).toBe(430);
    expect(order.orderRecipients).toHaveLength(1);
    expect(order.orderRecipients[0]?.priceMinor).toBe(250);
    expect(order.orderRecipients[0]?.postageMinor).toBe(180);
    expect(order.orderRecipients[0]?.status).toBe("approved");

    const occasion = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
    expect(occasion.status).toBe("queued");
  });

  describe("GET /batch-orders (the list)", () => {
    /**
     * The list row is a summary, not the order plus its cards.
     *
     * It used to be `include: { orderRecipients: true }`, so every card's whole
     * row — 636 bytes of address, price and timestamps — was fetched and sent to
     * render a count and a status pill. A bulk sender's fifty orders of
     * seventy-six cards came to over two megabytes of which about seventy
     * kilobytes was used, and every row carried a recipient's postal address to
     * a page that shows none.
     */
    it("summarises each order instead of shipping its cards", async () => {
      const { token } = await signUp();
      const savedDesignId = await createSavedDesign(token);
      await request(app.getHttpServer())
        .post("/batch-orders/quick-send")
        .set("Authorization", `Bearer ${token}`)
        .send({
          savedDesignId,
          firstName: "Jamie",
          lastName: "Pupil",
          shippingAddressLine1: "1 Test Street",
          shippingAddressCity: "London",
          shippingAddressPostcode: "SW1A 1AA",
          postageClass: "second_class",
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get("/batch-orders")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      const row = batchOrderListRowSchema.parse(
        (response.body as { items: unknown[] }).items[0],
      );
      expect(row.cardCount).toBe(1);
      expect(row.cardStatusCounts).toEqual({ approved: 1 });
      expect(row.sendSchedule.toCome).toBe(1);
    });

    it("never puts a recipient's postal address on the list", async () => {
      // The guard that matters. This is a page that renders no addresses, and
      // the ops order view already withholds them on the same reasoning (see
      // adminOrderLineSchema). Asserted on the raw JSON so re-adding an
      // `include` — at any nesting depth — fails here rather than shipping.
      const { token } = await signUp();
      const savedDesignId = await createSavedDesign(token);
      await request(app.getHttpServer())
        .post("/batch-orders/quick-send")
        .set("Authorization", `Bearer ${token}`)
        .send({
          savedDesignId,
          firstName: "Jamie",
          lastName: "Pupil",
          shippingAddressLine1: "77 Distinctive Avenue",
          shippingAddressCity: "London",
          shippingAddressPostcode: "SW1A 1AA",
          postageClass: "second_class",
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get("/batch-orders")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      const raw = JSON.stringify(response.body);
      expect(raw).not.toContain("77 Distinctive Avenue");
      expect(raw).not.toContain("shippingAddress");
      expect(raw).not.toContain("SW1A 1AA");
    });

    it("tells the list when each card posts, which it could not before", async () => {
      // The occasion join is the whole reason the list can signpost a scheduled
      // order at all. Without it every sendSchedule would report zero dates.
      const { token } = await signUp();
      const savedDesignId = await createSavedDesign(token);
      const deliverBy = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);
      await request(app.getHttpServer())
        .post("/batch-orders/quick-send")
        .set("Authorization", `Bearer ${token}`)
        .send({
          savedDesignId,
          firstName: "Jamie",
          lastName: "Pupil",
          shippingAddressLine1: "1 Test Street",
          shippingAddressCity: "London",
          shippingAddressPostcode: "SW1A 1AA",
          postageClass: "second_class",
          deliverBy,
        })
        .expect(201);

      const response = await request(app.getHttpServer())
        .get("/batch-orders")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);

      const row = batchOrderListRowSchema.parse(
        (response.body as { items: unknown[] }).items[0],
      );
      expect(row.sendSchedule.dateCount).toBe(1);
      expect(row.sendSchedule.earliest).not.toBeNull();
      expect(row.sendSchedule.isSpread).toBe(false);
    });
  });

  describe("quick-send (guided first order)", () => {
    function quickSendBody(savedDesignId: string) {
      return {
        savedDesignId,
        firstName: "Jamie",
        lastName: "Pupil",
        shippingAddressLine1: "1 Test Street",
        shippingAddressCity: "London",
        shippingAddressPostcode: "SW1A 1AA",
        postageClass: "second_class",
      };
    }

    it("turns a saved design + recipient into a ready-to-pay draft order in one call", async () => {
      const { token, accountId } = await signUp();
      const savedDesignId = await createSavedDesign(token);

      const response = await request(app.getHttpServer())
        .post("/batch-orders/quick-send")
        .set("Authorization", `Bearer ${token}`)
        .send(quickSendBody(savedDesignId))
        .expect(201);
      const order = batchOrderSchema.parse(response.body);

      // One 2nd-class card: £2.50 card + £0.91 stamp = £3.41.
      expect(order.status).toBe("draft");
      expect(order.subtotalMinor).toBe(250);
      expect(order.postageMinor).toBe(91);
      expect(order.totalMinor).toBe(341);
      expect(order.orderRecipients).toHaveLength(1);
      expect(order.orderRecipients[0]?.savedDesignId).toBe(savedDesignId);

      // It created exactly one recipient and one (now queued) occasion.
      expect(await prisma.recipient.count({ where: { accountId } })).toBe(1);
      const occasion = await prisma.occasion.findFirstOrThrow({ where: { accountId } });
      expect(occasion).toMatchObject({ status: "queued", source: "one_off_campaign" });

      // …and the returned draft checks out through the normal Stripe flow.
      const checkout = await request(app.getHttpServer())
        .post(`/batch-orders/${order.id}/checkout`)
        .set("Authorization", `Bearer ${token}`)
        .expect(201);
      expect(checkout.body).toEqual({
        checkoutUrl: expect.stringMatching(/^https:\/\/checkout\.stripe\.test\/pay\/cs_test_/),
      });
      expect(checkoutSessionsCreate).toHaveBeenCalledTimes(1);
    });

    it("attaches a chosen message page to the card's QR link (ADR 0132)", async () => {
      const { token, accountId } = await signUp();
      const savedDesignId = await createSavedDesign(token);
      const page = await prisma.messagePage.create({
        data: { accountId, title: "Watch this" },
      });

      const response = await request(app.getHttpServer())
        .post("/batch-orders/quick-send")
        .set("Authorization", `Bearer ${token}`)
        .send({ ...quickSendBody(savedDesignId), messagePageId: page.id })
        .expect(201);
      const order = batchOrderSchema.parse(response.body);

      // The chosen page rides onto the order line, so settlement mints the
      // card's QR link onto it rather than auto-creating a fresh page.
      const orderRecipient = await prisma.orderRecipient.findFirstOrThrow({
        where: { batchOrderId: order.id },
      });
      expect(orderRecipient.messagePageId).toBe(page.id);
    });

    it("404s a message page from another account (guarding the send-flow attach)", async () => {
      const owner = await signUp();
      const attacker = await signUp();
      const savedDesignId = await createSavedDesign(attacker.token);
      const foreignPage = await prisma.messagePage.create({
        data: { accountId: owner.accountId, title: "Not yours" },
      });

      await request(app.getHttpServer())
        .post("/batch-orders/quick-send")
        .set("Authorization", `Bearer ${attacker.token}`)
        .send({ ...quickSendBody(savedDesignId), messagePageId: foreignPage.id })
        .expect(404);
    });

    it("404s when the design belongs to another account (no order or recipient created)", async () => {
      const accountA = await signUp();
      const accountB = await signUp();
      const savedDesignId = await createSavedDesign(accountA.token);

      await request(app.getHttpServer())
        .post("/batch-orders/quick-send")
        .set("Authorization", `Bearer ${accountB.token}`)
        .send(quickSendBody(savedDesignId))
        .expect(404);

      // The foreign caller's account is left untouched — no stray recipient.
      expect(await prisma.recipient.count({ where: { accountId: accountB.accountId } })).toBe(0);
    });

    it("rejects an invalid postcode before creating anything", async () => {
      const { token, accountId } = await signUp();
      const savedDesignId = await createSavedDesign(token);

      await request(app.getHttpServer())
        .post("/batch-orders/quick-send")
        .set("Authorization", `Bearer ${token}`)
        .send({ ...quickSendBody(savedDesignId), shippingAddressPostcode: "NOPE" })
        .expect(400);

      expect(await prisma.recipient.count({ where: { accountId } })).toBe(0);
    });

    it("reuses an existing contact via recipientId (no duplicate created)", async () => {
      const { token, accountId } = await signUp();
      const savedDesignId = await createSavedDesign(token);
      const contactId = await createRecipient(token);
      const before = await prisma.recipient.count({ where: { accountId } });

      const response = await request(app.getHttpServer())
        .post("/batch-orders/quick-send")
        .set("Authorization", `Bearer ${token}`)
        .send({ ...quickSendBody(savedDesignId), recipientId: contactId })
        .expect(201);
      const order = batchOrderSchema.parse(response.body);

      // No new contact — the send hangs off the existing one.
      expect(await prisma.recipient.count({ where: { accountId } })).toBe(before);
      expect(order.orderRecipients[0]?.recipientId).toBe(contactId);
      const occasion = await prisma.occasion.findFirstOrThrow({
        where: { accountId, source: "one_off_campaign" },
      });
      expect(occasion.recipientId).toBe(contactId);
    });

    it("404s for a recipientId on another account (no order created)", async () => {
      const accountA = await signUp();
      const accountB = await signUp();
      const savedDesignId = await createSavedDesign(accountB.token);
      const foreignContact = await createRecipient(accountA.token);

      await request(app.getHttpServer())
        .post("/batch-orders/quick-send")
        .set("Authorization", `Bearer ${accountB.token}`)
        .send({ ...quickSendBody(savedDesignId), recipientId: foreignContact })
        .expect(404);
    });

    it("saves a new contact to the address book by default", async () => {
      const { token, accountId } = await signUp();
      const savedDesignId = await createSavedDesign(token);

      await request(app.getHttpServer())
        .post("/batch-orders/quick-send")
        .set("Authorization", `Bearer ${token}`)
        .send(quickSendBody(savedDesignId))
        .expect(201);

      const contact = await prisma.recipient.findFirstOrThrow({ where: { accountId } });
      expect(contact.status).toBe("active");
    });

    it("creates a hidden one-off when saveToContacts is false", async () => {
      const { token, accountId } = await signUp();
      const savedDesignId = await createSavedDesign(token);

      await request(app.getHttpServer())
        .post("/batch-orders/quick-send")
        .set("Authorization", `Bearer ${token}`)
        .send({ ...quickSendBody(savedDesignId), saveToContacts: false })
        .expect(201);

      // The recipient exists (the order needs it) but is archived + sourced
      // "one_off", so it's hidden from the address book and — being non-active —
      // never counts against the plan's recipient cap.
      const contacts = await prisma.recipient.findMany({ where: { accountId } });
      expect(contacts).toHaveLength(1);
      expect(contacts[0]).toMatchObject({ status: "archived", source: "one_off" });
      expect(await prisma.recipient.count({ where: { accountId, status: "active" } })).toBe(0);
    });
  });

  it("rejects an occasion that isn't approved", async () => {
    const { token } = await signUp();
    const recipientId = await createRecipient(token);
    const createResponse = await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "achievement", occasionDate: "2026-09-01", recipientId })
      .expect(201);
    const occasionId = (createResponse.body as { id: string }).id;

    await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [buildLine(occasionId)] })
      .expect(409);
  });

  it("rejects an org-wide occasion with no recipient", async () => {
    const { token } = await signUp();
    const savedDesignId = await createSavedDesign(token);
    const createResponse = await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "bespoke_campaign", occasionDate: "2026-09-01" })
      .expect(201);
    const occasionId = (createResponse.body as { id: string }).id;
    await request(app.getHttpServer())
      .post(`/occasions/${occasionId}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ savedDesignId })
      .expect(201);

    await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [buildLine(occasionId)] })
      .expect(400);
  });

  it("rejects an occasion belonging to another account", async () => {
    const { token } = await signUp();
    const occasionId = await createApprovedOccasion(token);

    const otherAccount = await signUp();
    await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${otherAccount.token}`)
      .send({ lines: [buildLine(occasionId)] })
      .expect(404);
  });

  it("rejects duplicate occasions within the same request", async () => {
    const { token } = await signUp();
    const occasionId = await createApprovedOccasion(token);

    await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [buildLine(occasionId), buildLine(occasionId)] })
      .expect(400);
  });

  it("allows exactly the plan's batch order max size and rejects one more", async () => {
    const { token } = await signUp();
    // Sequential, not Promise.all: concurrent Serializable transactions
    // against the same account's recipient cap would just add retry noise
    // here — this test is about the batch-order size limit, not the
    // recipient-cap race (already covered in recipients.e2e-spec.ts).
    const occasionIds: string[] = [];
    for (let i = 0; i < 11; i += 1) {
      occasionIds.push(await createApprovedOccasion(token));
    }

    // Exactly at the free plan's batchOrderMaxSize (10, per seed.ts) — the
    // boundary itself must succeed, not just fail one-over-the-limit.
    await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: occasionIds.slice(0, 10).map(buildLine) })
      .expect(201);

    await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: occasionIds.map(buildLine) })
      .expect(403);
  });

  it("lists and fetches batch orders scoped to the account", async () => {
    const { token } = await signUp();
    const occasionId = await createApprovedOccasion(token);
    await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [buildLine(occasionId)] })
      .expect(201);

    const listResponse = await request(app.getHttpServer())
      .get("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(paginatedBatchOrdersSchema.parse(listResponse.body).total).toBe(1);

    const otherAccount = await signUp();
    const otherListResponse = await request(app.getHttpServer())
      .get("/batch-orders")
      .set("Authorization", `Bearer ${otherAccount.token}`)
      .expect(200);
    expect(paginatedBatchOrdersSchema.parse(otherListResponse.body).total).toBe(0);
  });

  it("rejects findOne/checkout/cancel on a batch order belonging to another account", async () => {
    const { token } = await signUp();
    const occasionId = await createApprovedOccasion(token);
    const createResponse = await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [buildLine(occasionId)] })
      .expect(201);
    const order = batchOrderSchema.parse(createResponse.body);

    const otherAccount = await signUp();
    await request(app.getHttpServer())
      .get(`/batch-orders/${order.id}`)
      .set("Authorization", `Bearer ${otherAccount.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/batch-orders/${order.id}/checkout`)
      .set("Authorization", `Bearer ${otherAccount.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/batch-orders/${order.id}/cancel`)
      .set("Authorization", `Bearer ${otherAccount.token}`)
      .expect(404);
    expect(checkoutSessionsCreate).not.toHaveBeenCalled();

    // Still a live draft for its real owner afterwards.
    const stillDraft = await prisma.batchOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(stillDraft.status).toBe("draft");
  });

  it("checks out a draft batch order via a mocked Stripe Checkout Session", async () => {
    const { token } = await signUp();
    const occasionId = await createApprovedOccasion(token);
    const createResponse = await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [buildLine(occasionId)] })
      .expect(201);
    const order = batchOrderSchema.parse(createResponse.body);

    const checkoutResponse = await request(app.getHttpServer())
      .post(`/batch-orders/${order.id}/checkout`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(checkoutResponse.body).toEqual({
      checkoutUrl: expect.stringMatching(/^https:\/\/checkout\.stripe\.test\/pay\/cs_test_/),
    });
    expect(checkoutSessionsCreate).toHaveBeenCalledTimes(1);
    const [sessionArgs] = checkoutSessionsCreate.mock.calls[0] as [
      Stripe.Checkout.SessionCreateParams,
    ];
    expect(sessionArgs.mode).toBe("payment");
    // £2.50 card + £1.80 first-class stamp = £4.30 charged.
    expect(sessionArgs.line_items?.[0]?.price_data?.unit_amount).toBe(430);

    const stored = await prisma.batchOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.status).toBe("pending_payment");
    expect(stored.stripePaymentIntentId).toMatch(/^pi_test_/);
  });

  it("accepts an empty optional shippingAddressLine2 (blank → not provided)", async () => {
    const { token } = await signUp();
    const occasionId = await createApprovedOccasion(token);

    // The web checkout form sends "" for a left-blank optional Address line 2.
    // That must be treated as "not provided", not rejected by the min-length
    // rule — otherwise a valid order can never be placed. See common/transforms.
    const createResponse = await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [{ ...buildLine(occasionId), shippingAddressLine2: "" }] })
      .expect(201);
    const order = batchOrderSchema.parse(createResponse.body);

    const stored = await prisma.orderRecipient.findFirstOrThrow({
      where: { batchOrderId: order.id },
    });
    // Persisted as null, not an empty string.
    expect(stored.shippingAddressLine2).toBeNull();
  });

  it("resumes checkout on a pending_payment order, minting a fresh Stripe session", async () => {
    const { token } = await signUp();
    const occasionId = await createApprovedOccasion(token);
    const createResponse = await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [buildLine(occasionId)] })
      .expect(201);
    const order = batchOrderSchema.parse(createResponse.body);

    // First checkout: draft → pending_payment, one session.
    await request(app.getHttpServer())
      .post(`/batch-orders/${order.id}/checkout`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    // The buyer closed Stripe without paying; the order is stuck pending_payment.
    // Clicking "Resume checkout" hits the same endpoint again with an explicit
    // resume intent — it must succeed and mint a NEW session rather than reject
    // the (now non-draft) order.
    const resume = await request(app.getHttpServer())
      .post(`/batch-orders/${order.id}/checkout`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resume: true })
      .expect(201);
    expect(resume.body).toEqual({
      checkoutUrl: expect.stringMatching(/^https:\/\/checkout\.stripe\.test\/pay\/cs_test_/),
    });
    expect(checkoutSessionsCreate).toHaveBeenCalledTimes(2);

    const stored = await prisma.batchOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.status).toBe("pending_payment");
  });

  it("rejects re-checkout of a pending_payment order without an explicit resume intent", async () => {
    const { token } = await signUp();
    const occasionId = await createApprovedOccasion(token);
    const createResponse = await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [buildLine(occasionId)] })
      .expect(201);
    const order = batchOrderSchema.parse(createResponse.body);

    // First checkout: draft → pending_payment, one session.
    await request(app.getHttpServer())
      .post(`/batch-orders/${order.id}/checkout`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    expect(checkoutSessionsCreate).toHaveBeenCalledTimes(1);

    // A second checkout WITHOUT the resume flag is treated as a stray/duplicate
    // first-checkout submit, not a resume: it must be rejected and must never
    // reach Stripe. This is the guarantee that makes the concurrent-double-submit
    // case safe (the loser reads pending_payment but has no resume intent).
    await request(app.getHttpServer())
      .post(`/batch-orders/${order.id}/checkout`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);
    expect(checkoutSessionsCreate).toHaveBeenCalledTimes(1);
  });

  it("rejects checking out a cancelled batch order", async () => {
    const { token } = await signUp();
    const occasionId = await createApprovedOccasion(token);
    const createResponse = await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [buildLine(occasionId)] })
      .expect(201);
    const order = batchOrderSchema.parse(createResponse.body);

    await request(app.getHttpServer())
      .post(`/batch-orders/${order.id}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    // A cancelled order is final — not re-payable.
    await request(app.getHttpServer())
      .post(`/batch-orders/${order.id}/checkout`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);
    expect(checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("cancels a draft batch order and reverts its occasion back to approved", async () => {
    const { token } = await signUp();
    const occasionId = await createApprovedOccasion(token);
    const createResponse = await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [buildLine(occasionId)] })
      .expect(201);
    const order = batchOrderSchema.parse(createResponse.body);

    const cancelResponse = await request(app.getHttpServer())
      .post(`/batch-orders/${order.id}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    const cancelled = batchOrderSchema.parse(cancelResponse.body);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.orderRecipients).toHaveLength(0);

    const occasion = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
    expect(occasion.status).toBe("approved");

    // The occasion is free to be checked out again into a new batch order.
    await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [buildLine(occasionId)] })
      .expect(201);
  });

  it("cancels a pending_payment batch order, releasing it back to the account", async () => {
    // A customer who checked out but abandoned or failed Stripe Checkout
    // must have a way to release the order rather than it being stuck
    // forever — cancel() deliberately allows this status too, not just draft.
    const { token } = await signUp();
    const occasionId = await createApprovedOccasion(token);
    const createResponse = await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [buildLine(occasionId)] })
      .expect(201);
    const order = batchOrderSchema.parse(createResponse.body);

    await request(app.getHttpServer())
      .post(`/batch-orders/${order.id}/checkout`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    const cancelResponse = await request(app.getHttpServer())
      .post(`/batch-orders/${order.id}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    expect(batchOrderSchema.parse(cancelResponse.body).status).toBe("cancelled");

    const occasion = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
    expect(occasion.status).toBe("approved");
  });

  it("rejects cancelling a paid batch order", async () => {
    const { token } = await signUp();
    const occasionId = await createApprovedOccasion(token);
    const createResponse = await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [buildLine(occasionId)] })
      .expect(201);
    const order = batchOrderSchema.parse(createResponse.body);

    await request(app.getHttpServer())
      .post(`/batch-orders/${order.id}/checkout`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    // Simulate the webhook marking it paid, since this test file has no real
    // Stripe to complete a checkout through.
    await prisma.batchOrder.update({ where: { id: order.id }, data: { status: "paid" } });

    await request(app.getHttpServer())
      .post(`/batch-orders/${order.id}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);
  });

  describe("cancel & refund (self-serve, ADR 0131)", () => {
    /** Drives an approved occasion through to a PAID, settled order with a
     * pending FulfillmentJob per card — the state the webhook leaves behind —
     * so a self-serve refund has something realistic to release. Returns the
     * order id and its recipient/occasion ids. */
    async function paidOrderWithPendingJobs(
      token: string,
      paymentMethod: "card" | "wallet",
    ): Promise<{ orderId: string; recipientLineIds: string[]; occasionId: string }> {
      const occasionId = await createApprovedOccasion(token);
      const createResponse = await request(app.getHttpServer())
        .post("/batch-orders")
        .set("Authorization", `Bearer ${token}`)
        .send({ lines: [buildLine(occasionId)] })
        .expect(201);
      const order = batchOrderSchema.parse(createResponse.body);

      // Checkout mints the pi id we later refund against (card path).
      await request(app.getHttpServer())
        .post(`/batch-orders/${order.id}/checkout`)
        .set("Authorization", `Bearer ${token}`)
        .expect(201);

      // Stand in for the webhook: mark paid + settle a pending job per card.
      await prisma.batchOrder.update({
        where: { id: order.id },
        data: { status: "paid", paymentMethod },
      });
      const lines = await prisma.orderRecipient.findMany({
        where: { batchOrderId: order.id },
      });
      await prisma.orderRecipient.updateMany({
        where: { batchOrderId: order.id },
        data: { status: "queued" },
      });
      await prisma.fulfillmentJob.createMany({
        data: lines.map((line) => ({ orderRecipientId: line.id, status: "pending" as const })),
      });
      return { orderId: order.id, recipientLineIds: lines.map((l) => l.id), occasionId };
    }

    it("refunds a paid card order to Stripe and releases it", async () => {
      const { token } = await signUp();
      const { orderId, recipientLineIds, occasionId } = await paidOrderWithPendingJobs(
        token,
        "card",
      );
      const before = await prisma.batchOrder.findUniqueOrThrow({ where: { id: orderId } });

      const response = await request(app.getHttpServer())
        .post(`/batch-orders/${orderId}/cancel-refund`)
        .set("Authorization", `Bearer ${token}`)
        .expect(201);
      expect(batchOrderSchema.parse(response.body).status).toBe("cancelled");

      // Refunded once, against the payment intent, keyed on the order id so a
      // retry can never double-refund.
      expect(refundsCreate).toHaveBeenCalledTimes(1);
      expect(refundsCreate).toHaveBeenCalledWith(
        { payment_intent: before.stripePaymentIntentId },
        { idempotencyKey: `refund:${orderId}` },
      );

      // The order is released: cards cancelled, occasion skipped, jobs dropped.
      const lines = await prisma.orderRecipient.findMany({ where: { batchOrderId: orderId } });
      expect(lines.every((l) => l.status === "cancelled")).toBe(true);
      const occasion = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
      expect(occasion.status).toBe("skipped");
      const jobs = await prisma.fulfillmentJob.findMany({
        where: { orderRecipientId: { in: recipientLineIds } },
      });
      expect(jobs).toHaveLength(0);
    });

    it("refunds a paid wallet order to the ledger and never calls Stripe", async () => {
      const { token, accountId } = await signUp();
      const { orderId } = await paidOrderWithPendingJobs(token, "wallet");
      const order = await prisma.batchOrder.findUniqueOrThrow({ where: { id: orderId } });

      await request(app.getHttpServer())
        .post(`/batch-orders/${orderId}/cancel-refund`)
        .set("Authorization", `Bearer ${token}`)
        .expect(201);

      expect(refundsCreate).not.toHaveBeenCalled();
      const entries = await prisma.walletLedgerEntry.findMany({
        where: { accountId, reference: `refund:${orderId}` },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ type: "refund", amountMinor: order.totalMinor });
    });

    it("refuses to refund once any card has started, and issues no refund", async () => {
      const { token } = await signUp();
      const { orderId, recipientLineIds } = await paidOrderWithPendingJobs(token, "card");
      // A card has moved into production — self-serve refund must stop here.
      await prisma.fulfillmentJob.updateMany({
        where: { orderRecipientId: recipientLineIds[0]! },
        data: { status: "in_progress" },
      });

      await request(app.getHttpServer())
        .post(`/batch-orders/${orderId}/cancel-refund`)
        .set("Authorization", `Bearer ${token}`)
        .expect(409);
      expect(refundsCreate).not.toHaveBeenCalled();
      const order = await prisma.batchOrder.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe("paid");
    });

    it("refuses to refund an unpaid draft order", async () => {
      const { token } = await signUp();
      const occasionId = await createApprovedOccasion(token);
      const createResponse = await request(app.getHttpServer())
        .post("/batch-orders")
        .set("Authorization", `Bearer ${token}`)
        .send({ lines: [buildLine(occasionId)] })
        .expect(201);
      const order = batchOrderSchema.parse(createResponse.body);

      await request(app.getHttpServer())
        .post(`/batch-orders/${order.id}/cancel-refund`)
        .set("Authorization", `Bearer ${token}`)
        .expect(409);
      expect(refundsCreate).not.toHaveBeenCalled();
    });

    it("does not let another account refund your order", async () => {
      const owner = await signUp();
      const intruder = await signUp();
      const { orderId } = await paidOrderWithPendingJobs(owner.token, "card");

      await request(app.getHttpServer())
        .post(`/batch-orders/${orderId}/cancel-refund`)
        .set("Authorization", `Bearer ${intruder.token}`)
        .expect(404);
      expect(refundsCreate).not.toHaveBeenCalled();
    });
  });

  it("rejects checking out a batch order twice concurrently — only one Stripe session is created", async () => {
    const { token } = await signUp();
    const occasionId = await createApprovedOccasion(token);
    const createResponse = await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: [buildLine(occasionId)] })
      .expect(201);
    const order = batchOrderSchema.parse(createResponse.body);

    const results = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post(`/batch-orders/${order.id}/checkout`)
          .set("Authorization", `Bearer ${token}`),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    // The atomic guard runs before the Stripe call, so the loser must never
    // reach Stripe at all — not just lose the race after also calling it.
    expect(checkoutSessionsCreate).toHaveBeenCalledTimes(1);
  });

  describe("bulk-send (one design → many existing contacts)", () => {
    async function createRecipientWithAddress(
      token: string,
      overrides: Record<string, unknown> = {},
    ): Promise<string> {
      const response = await request(app.getHttpServer())
        .post("/recipients")
        .set("Authorization", `Bearer ${token}`)
        .send({
          firstName: "Alex",
          lastName: `Contact ${randomUUID().slice(0, 8)}`,
          addressLine1: "1 Test Street",
          addressCity: "London",
          addressPostcode: "SW1A 1AA",
          ...overrides,
        })
        .expect(201);
      return (response.body as { id: string }).id;
    }

    it("turns one design + several contacts into a single ready-to-pay order", async () => {
      const { token, accountId } = await signUp();
      const savedDesignId = await createSavedDesign(token);
      const recipientIds = [
        await createRecipientWithAddress(token),
        await createRecipientWithAddress(token),
        await createRecipientWithAddress(token),
      ];

      const response = await request(app.getHttpServer())
        .post("/batch-orders/bulk-send")
        .set("Authorization", `Bearer ${token}`)
        .send({ savedDesignId, recipientIds, postageClass: "second_class" })
        .expect(201);
      const order = batchOrderSchema.parse(response.body);

      // Three 2nd-class cards: 3 × (£2.50 + £0.91) = £10.23.
      expect(order.status).toBe("draft");
      expect(order.subtotalMinor).toBe(750);
      expect(order.postageMinor).toBe(273);
      expect(order.totalMinor).toBe(1023);
      expect(order.orderRecipients).toHaveLength(3);

      // Every line reuses the ONE design and is addressed from its contact.
      expect(order.orderRecipients.every((r) => r.savedDesignId === savedDesignId)).toBe(true);
      expect(new Set(order.orderRecipients.map((r) => r.recipientId))).toEqual(
        new Set(recipientIds),
      );
      expect(order.orderRecipients.every((r) => r.shippingAddressPostcode === "SW1A 1AA")).toBe(
        true,
      );

      // One approved-then-queued one-off occasion was created per contact.
      const occasions = await prisma.occasion.findMany({ where: { accountId } });
      expect(occasions).toHaveLength(3);
      expect(occasions.every((o) => o.status === "queued" && o.source === "one_off_campaign")).toBe(
        true,
      );

      // …and it checks out through the normal Stripe flow.
      await request(app.getHttpServer())
        .post(`/batch-orders/${order.id}/checkout`)
        .set("Authorization", `Bearer ${token}`)
        .expect(201);
    });

    /** A contact with a real dated occasion ahead of them, as a list-style send
     *  would find: created directly, with no segment involved. */
    async function contactWithBirthday(
      token: string,
      accountId: string,
      daysAhead: number,
    ): Promise<{ contactId: string; occasionId: string; occasionDate: Date }> {
      const contactId = await createRecipientWithAddress(token);
      const occasionDate = new Date();
      occasionDate.setUTCDate(occasionDate.getUTCDate() + daysAhead);
      occasionDate.setUTCHours(0, 0, 0, 0);
      const occasion = await prisma.occasion.create({
        data: {
          accountId,
          recipientId: contactId,
          type: "birthday",
          source: "recurring_per_recipient",
          occasionDate,
          dispatchDate: occasionDate,
          status: "scheduled",
          dispatchOption: "auto_send",
          postageClass: "second_class",
        },
      });
      return { contactId, occasionId: occasion.id, occasionDate };
    }

    it("posts on each recipient's own date when asked, with no reconcile list from the client", async () => {
      const { token, accountId } = await signUp();
      const savedDesignId = await createSavedDesign(token);
      // Two contacts with birthdays months apart. This is the shape that broke:
      // picked from a list rather than a segment, so the composer sends no
      // `reconcile` and every card used to be dated today.
      const alice = await contactWithBirthday(token, accountId, 40);
      const bob = await contactWithBirthday(token, accountId, 90);

      await request(app.getHttpServer())
        .post("/batch-orders/bulk-send")
        .set("Authorization", `Bearer ${token}`)
        .send({
          savedDesignId,
          recipientIds: [alice.contactId, bob.contactId],
          postageClass: "second_class",
          useOccasionDates: true,
          // Deliberately no `reconcile` — the server finds the occasions itself.
        })
        .expect(201);

      // Their own birthday occasions were reused, not superseded by one-offs.
      expect(
        await prisma.occasion.count({ where: { accountId, source: "one_off_campaign" } }),
      ).toBe(0);

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      for (const person of [alice, bob]) {
        const occasion = await prisma.occasion.findUniqueOrThrow({
          where: { id: person.occasionId },
        });
        expect(occasion.savedDesignId).toBe(savedDesignId);
        // The whole point: posted ahead of their own birthday, not today.
        expect(occasion.dispatchDate).not.toBeNull();
        expect(occasion.dispatchDate!.getTime()).toBeGreaterThan(today.getTime());
        expect(occasion.dispatchDate!.getTime()).toBeLessThanOrEqual(person.occasionDate.getTime());
      }

      // And the two cards post on different days, since the birthdays differ —
      // the symptom was 76 cards all landing on one date.
      const dates = await prisma.occasion.findMany({
        where: { accountId },
        select: { dispatchDate: true },
      });
      const distinct = new Set(dates.map((d) => d.dispatchDate?.getTime()));
      expect(distinct.size).toBe(2);
    });

    it("dates by birthday without being asked, which is the default", async () => {
      const { token, accountId } = await signUp();
      const savedDesignId = await createSavedDesign(token);
      // The Anytime Fitness shape exactly: contacts picked by hand, no segment,
      // no reconcile list, no flag, no delivery date. This used to date all of
      // them today; birthday timing is now what a bulk send does unless it says
      // otherwise.
      const alice = await contactWithBirthday(token, accountId, 40);
      const bob = await contactWithBirthday(token, accountId, 90);

      await request(app.getHttpServer())
        .post("/batch-orders/bulk-send")
        .set("Authorization", `Bearer ${token}`)
        .send({
          savedDesignId,
          recipientIds: [alice.contactId, bob.contactId],
          postageClass: "second_class",
        })
        .expect(201);

      // Their own birthdays were reused, so no one-offs were minted at all.
      expect(
        await prisma.occasion.count({ where: { accountId, source: "one_off_campaign" } }),
      ).toBe(0);
      const dispatches = await prisma.occasion.findMany({
        where: { accountId },
        select: { dispatchDate: true },
      });
      expect(new Set(dispatches.map((d) => d.dispatchDate?.getTime())).size).toBe(2);
    });

    it("warns before payment when the back's artwork will be clipped", async () => {
      const { token } = await signUp();
      const savedDesignId = await createSavedDesign(token);
      const recipientId = await createRecipientWithAddress(token);

      const clean = await request(app.getHttpServer())
        .post("/batch-orders/preflight")
        .set("Authorization", `Bearer ${token}`)
        .send({ savedDesignId, recipientIds: [recipientId], postageClass: "second_class" })
        .expect(201);
      expect(
        (clean.body as { backArtworkClipped: { background: boolean } }).backArtworkClipped,
      ).toEqual({ background: false, elements: 0 });

      // Fill the back edge to edge, exactly as the order that prompted the
      // reserved strip did. A background is not an "element", which is why the
      // editor's own check saw nothing wrong with it.
      const design = await prisma.savedDesign.findUniqueOrThrow({ where: { id: savedDesignId } });
      const document = design.document as { pages: { name: string }[] };
      await prisma.savedDesign.update({
        where: { id: savedDesignId },
        data: {
          document: {
            ...document,
            pages: document.pages.map((page) =>
              page.name === "back"
                ? { ...page, background: { type: "color", color: "#101010" } }
                : page,
            ),
          } as never,
        },
      });

      const flagged = await request(app.getHttpServer())
        .post("/batch-orders/preflight")
        .set("Authorization", `Bearer ${token}`)
        .send({ savedDesignId, recipientIds: [recipientId], postageClass: "second_class" })
        .expect(201);
      expect(
        (flagged.body as { backArtworkClipped: { background: boolean } }).backArtworkClipped
          .background,
      ).toBe(true);
    });

    it("previews the occasion dating the send will actually apply", async () => {
      const { token, accountId } = await signUp();
      const savedDesignId = await createSavedDesign(token);
      const alice = await contactWithBirthday(token, accountId, 40);
      const bob = await contactWithBirthday(token, accountId, 90);
      // No birthday on file — posts on the shared date, and must not be counted.
      const carol = await createRecipientWithAddress(token);
      const recipientIds = [alice.contactId, bob.contactId, carol];

      const preflight = await request(app.getHttpServer())
        .post("/batch-orders/preflight")
        .set("Authorization", `Bearer ${token}`)
        .send({ savedDesignId, recipientIds, postageClass: "second_class" })
        .expect(201);
      const { occasionDated } = preflight.body as {
        occasionDated: { count: number; earliest: string | null; latest: string | null };
      };

      expect(occasionDated.count).toBe(2);
      expect(occasionDated.earliest).toBe(alice.occasionDate.toISOString().slice(0, 10));
      expect(occasionDated.latest).toBe(bob.occasionDate.toISOString().slice(0, 10));

      // The point of the preview is that it is not a second opinion. Send the
      // same selection the same way the composer would and the outcome has to
      // match it exactly — if these two ever drift, the composer is quietly
      // lying to the sender about when their cards go.
      await request(app.getHttpServer())
        .post("/batch-orders/bulk-send")
        .set("Authorization", `Bearer ${token}`)
        .send({ savedDesignId, recipientIds, postageClass: "second_class" })
        .expect(201);

      const reused = await prisma.occasion.findMany({
        where: { accountId, source: { not: "one_off_campaign" }, savedDesignId },
        select: { occasionDate: true },
        orderBy: { occasionDate: "asc" },
      });
      expect(reused).toHaveLength(occasionDated.count);
      expect(reused[0]!.occasionDate.toISOString().slice(0, 10)).toBe(occasionDated.earliest);
      expect(reused[reused.length - 1]!.occasionDate.toISOString().slice(0, 10)).toBe(
        occasionDated.latest,
      );
    });

    it("still posts everything today for a campaign that opts out", async () => {
      const { token, accountId } = await signUp();
      const savedDesignId = await createSavedDesign(token);
      // A genuine campaign — "we've moved premises" — to contacts who happen to
      // have birthdays coming. Those must NOT hijack the send's timing.
      const alice = await contactWithBirthday(token, accountId, 40);
      const bob = await contactWithBirthday(token, accountId, 90);

      await request(app.getHttpServer())
        .post("/batch-orders/bulk-send")
        .set("Authorization", `Bearer ${token}`)
        .send({
          savedDesignId,
          recipientIds: [alice.contactId, bob.contactId],
          postageClass: "second_class",
          useOccasionDates: false,
        })
        .expect(201);

      // Fresh one-off occasions for both, dated now — their birthdays untouched.
      const oneOffs = await prisma.occasion.findMany({
        where: { accountId, source: "one_off_campaign" },
        select: { dispatchDate: true },
      });
      expect(oneOffs).toHaveLength(2);
      const distinct = new Set(oneOffs.map((o) => o.dispatchDate?.getTime()));
      expect(distinct.size).toBe(1);

      for (const id of [alice.occasionId, bob.occasionId]) {
        const untouched = await prisma.occasion.findUniqueOrThrow({ where: { id } });
        expect(untouched.savedDesignId).toBeNull();
        expect(untouched.status).toBe("scheduled");
      }
    });

    it("refuses a send that asks for both a shared delivery date and occasion dates", async () => {
      const { token, accountId } = await signUp();
      const savedDesignId = await createSavedDesign(token);
      const alice = await contactWithBirthday(token, accountId, 40);
      const deliverBy = new Date();
      deliverBy.setUTCDate(deliverBy.getUTCDate() + 30);

      await request(app.getHttpServer())
        .post("/batch-orders/bulk-send")
        .set("Authorization", `Bearer ${token}`)
        .send({
          savedDesignId,
          recipientIds: [alice.contactId],
          postageClass: "second_class",
          useOccasionDates: true,
          deliverBy: deliverBy.toISOString().slice(0, 10),
        })
        .expect(400);
    });

    it("never dates a card in the past, even for a birthday that is nearly here", async () => {
      const { token, accountId } = await signUp();
      const savedDesignId = await createSavedDesign(token);
      // Tomorrow: back-computing the postage lead from it lands before today.
      const soon = await contactWithBirthday(token, accountId, 1);

      await request(app.getHttpServer())
        .post("/batch-orders/bulk-send")
        .set("Authorization", `Bearer ${token}`)
        .send({
          savedDesignId,
          recipientIds: [soon.contactId],
          postageClass: "second_class",
          useOccasionDates: true,
        })
        .expect(201);

      // Due now, not overdue on arrival — a card born into the ops overdue band
      // is a false SLA alarm for an order placed a moment ago.
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const occasion = await prisma.occasion.findUniqueOrThrow({
        where: { id: soon.occasionId },
      });
      expect(occasion.dispatchDate!.getTime()).toBeGreaterThanOrEqual(today.getTime());
    });

    describe("ops re-date repair (orders placed before #328)", () => {
      /** Reproduce the broken shape: a send that ignored the recipients' real
       *  birthdays and dated every card the same day. */
      async function misdatedOrder(token: string, accountId: string, daysAhead: number[]) {
        const savedDesignId = await createSavedDesign(token);
        const people = [];
        for (const days of daysAhead) {
          people.push(await contactWithBirthday(token, accountId, days));
        }
        const order = await request(app.getHttpServer())
          .post("/batch-orders/bulk-send")
          .set("Authorization", `Bearer ${token}`)
          .send({
            savedDesignId,
            recipientIds: people.map((p) => p.contactId),
            postageClass: "second_class",
            // Opt out explicitly, which is now the only way to produce the
            // broken shape this repair exists for. Before occasion dating became
            // the default, simply omitting the flag did it — which is precisely
            // how ~76 real cards ended up on one date.
            useOccasionDates: false,
          })
          .expect(201);
        const orderId = (order.body as { id: string }).id;
        await settleAsWebhookWould(orderId);
        return { orderId, people };
      }

      /**
       * Stand in for the payment webhook, mirroring settleFulfillment: paid,
       * cards queued, and one pending job per card carrying the occasion's
       * dispatch date.
       *
       * That denormalised dueDate is what the ops calendar plots, so the repair
       * has to move it too — a test that only checked the occasion would miss
       * the queue still showing the old day.
       */
      async function settleAsWebhookWould(orderId: string) {
        await prisma.batchOrder.update({ where: { id: orderId }, data: { status: "paid" } });
        const lines = await prisma.orderRecipient.findMany({
          where: { batchOrderId: orderId },
          include: { occasion: { select: { dispatchDate: true } } },
        });
        await prisma.orderRecipient.updateMany({
          where: { batchOrderId: orderId },
          data: { status: "queued" },
        });
        await prisma.fulfillmentJob.createMany({
          data: lines.map((line) => ({
            orderRecipientId: line.id,
            status: "pending" as const,
            dueDate: line.occasion?.dispatchDate ?? null,
          })),
        });
      }

      it("re-dates each card to its recipient's birthday and stops the birthday sending again", async () => {
        const { token, accountId } = await signUp();
        const ops = await opsToken();
        const { orderId, people } = await misdatedOrder(token, accountId, [40, 90]);

        // Precondition: both cards share one date. This is the bug, reproduced.
        const before = await prisma.occasion.findMany({
          where: { accountId, source: "one_off_campaign" },
          select: { dispatchDate: true },
        });
        expect(new Set(before.map((o) => o.dispatchDate?.getTime())).size).toBe(1);

        const response = await request(app.getHttpServer())
          .post(`/admin/orders/${orderId}/redate-to-occasions`)
          .set("Authorization", `Bearer ${ops}`)
          .expect(201);
        const summary = response.body as { redated: number; unchanged: number };
        expect(summary.redated).toBe(2);
        expect(summary.unchanged).toBe(0);

        // Each card now posts ahead of its own birthday, on its own day.
        const after = await prisma.occasion.findMany({
          where: { accountId, source: "one_off_campaign" },
          select: { dispatchDate: true, supersedesOccasionId: true },
        });
        expect(new Set(after.map((o) => o.dispatchDate?.getTime())).size).toBe(2);

        // The part that matters most: each natural birthday is consumed, so it
        // cannot independently fire a second card on the same day. Without this
        // the repair would give every recipient two cards.
        for (const person of people) {
          const natural = await prisma.occasion.findUniqueOrThrow({
            where: { id: person.occasionId },
          });
          expect(natural.status).toBe("skipped");
        }
        expect(after.every((o) => o.supersedesOccasionId !== null)).toBe(true);

        // And the ops queue agrees — dueDate moved with it.
        const jobs = await prisma.fulfillmentJob.findMany({
          where: { orderRecipient: { batchOrder: { id: orderId } } },
          select: { dueDate: true },
        });
        expect(new Set(jobs.map((j) => j.dueDate?.getTime())).size).toBe(2);
      });

      it("moves each card's occasion date onto the birthday, not just its post date", async () => {
        const { token, accountId } = await signUp();
        const ops = await opsToken();
        const { orderId } = await misdatedOrder(token, accountId, [40, 90]);

        await request(app.getHttpServer())
          .post(`/admin/orders/${orderId}/redate-to-occasions`)
          .set("Authorization", `Bearer ${ops}`)
          .expect(201);

        // `occasionDate` is the field the {occasionDate} / {date} merge tokens
        // print from — and the one the repair originally left behind, so a
        // repaired card would post on the right day carrying the day it was
        // ordered. Two recipients, two birthdays, two distinct dates.
        const after = await prisma.occasion.findMany({
          where: { accountId, source: "one_off_campaign" },
          select: { occasionDate: true },
        });
        expect(after).toHaveLength(2);
        expect(new Set(after.map((o) => o.occasionDate?.getTime())).size).toBe(2);
      });

      it("is safe to run twice", async () => {
        const { token, accountId } = await signUp();
        const ops = await opsToken();
        const { orderId } = await misdatedOrder(token, accountId, [40, 90]);

        const url = `/admin/orders/${orderId}/redate-to-occasions`;
        await request(app.getHttpServer())
          .post(url)
          .set("Authorization", `Bearer ${ops}`)
          .expect(201);
        const second = await request(app.getHttpServer())
          .post(url)
          .set("Authorization", `Bearer ${ops}`)
          .expect(201);

        // Nothing left to do, and nothing re-consumed.
        const summary = second.body as { redated: number; unchanged: number };
        expect(summary.redated).toBe(0);
        expect(summary.unchanged).toBe(2);
      });

      it("refuses once a card has left pending", async () => {
        const { token, accountId } = await signUp();
        const ops = await opsToken();
        const { orderId } = await misdatedOrder(token, accountId, [40, 90]);

        // One card is already being prepared — it has left the queue's control.
        const job = await prisma.fulfillmentJob.findFirstOrThrow({
          where: { orderRecipient: { batchOrder: { id: orderId } } },
        });
        await prisma.fulfillmentJob.update({
          where: { id: job.id },
          data: { status: "printed" },
        });

        await request(app.getHttpServer())
          .post(`/admin/orders/${orderId}/redate-to-occasions`)
          .set("Authorization", `Bearer ${ops}`)
          .expect(409);
      });

      it("leaves a card alone when its recipient has no dated occasion", async () => {
        const { token } = await signUp();
        const ops = await opsToken();
        const savedDesignId = await createSavedDesign(token);
        // A genuine campaign recipient: no birthday on file.
        const plain = await createRecipientWithAddress(token);
        const order = await request(app.getHttpServer())
          .post("/batch-orders/bulk-send")
          .set("Authorization", `Bearer ${token}`)
          .send({ savedDesignId, recipientIds: [plain], postageClass: "second_class" })
          .expect(201);
        const plainOrderId = (order.body as { id: string }).id;
        await settleAsWebhookWould(plainOrderId);

        const response = await request(app.getHttpServer())
          .post(`/admin/orders/${plainOrderId}/redate-to-occasions`)
          .set("Authorization", `Bearer ${ops}`)
          .expect(201);
        const summary = response.body as { redated: number; unchanged: number };
        expect(summary.redated).toBe(0);
        expect(summary.unchanged).toBe(1);
      });

      it("refuses a non-operator", async () => {
        const { token, accountId } = await signUp();
        const { orderId } = await misdatedOrder(token, accountId, [40]);
        await request(app.getHttpServer())
          .post(`/admin/orders/${orderId}/redate-to-occasions`)
          .set("Authorization", `Bearer ${token}`)
          .expect(403);
      });
    });

    it("reuses the natural birthday occasion as the send record when reconciled", async () => {
      const { token, accountId } = await signUp();
      const savedDesignId = await createSavedDesign(token);
      const contactId = await createRecipientWithAddress(token);

      // A natural birthday occasion for the contact, dated a few weeks out — the
      // kind the birthday segment matches and offers to mark handled.
      const birthdayDate = new Date();
      birthdayDate.setUTCDate(birthdayDate.getUTCDate() + 20);
      const birthday = await prisma.occasion.create({
        data: {
          accountId,
          recipientId: contactId,
          type: "birthday",
          source: "recurring_per_recipient",
          occasionDate: birthdayDate,
          dispatchDate: birthdayDate,
          status: "scheduled",
          dispatchOption: "auto_send",
          postageClass: "second_class",
        },
      });

      await request(app.getHttpServer())
        .post("/batch-orders/bulk-send")
        .set("Authorization", `Bearer ${token}`)
        .send({
          savedDesignId,
          recipientIds: [contactId],
          postageClass: "second_class",
          reconcile: [{ recipientId: contactId, occasionId: birthday.id }],
        })
        .expect(201);

      // No superseding one-off is minted: the natural birthday occasion itself
      // becomes the send record. So there's still exactly ONE occasion for the
      // account, and no one_off_campaign send occasion exists.
      const occasions = await prisma.occasion.findMany({ where: { accountId } });
      expect(occasions).toHaveLength(1);
      expect(
        await prisma.occasion.count({ where: { accountId, source: "one_off_campaign" } }),
      ).toBe(0);

      // The reused occasion keeps its birthday classification AND its own
      // birthday date — the card's calendar event sits on the real birthday, not
      // the send day. It now carries the bulk design and was checked out (queued),
      // and its post-by date is computed from that birthday (send-by-5 working
      // days before it), NOT the send day — so a birthday-segment send posts each
      // card timed to arrive for the birthday, not all today. See ADR 0160.
      const sent = occasions[0]!;
      expect(sent.id).toBe(birthday.id);
      expect(sent.type).toBe("birthday");
      expect(sent.source).toBe("recurring_per_recipient");
      expect(sent.supersedesOccasionId).toBeNull();
      expect(sent.savedDesignId).toBe(savedDesignId);
      expect(sent.dispatchOption).toBe("asap");
      expect(sent.status).toBe("queued");
      expect(sent.occasionDate.getTime()).toBe(startOfUtcDay(birthdayDate).getTime());
      expect(sent.dispatchDate?.getTime()).toBe(
        computeDispatchDate(birthdayDate, POSTAGE_LEAD_DAYS.second_class).getTime(),
      );
    });

    it("blocks the send and names contacts missing a postal address (no order created)", async () => {
      const { token, accountId } = await signUp();
      const savedDesignId = await createSavedDesign(token);
      const withAddress = await createRecipientWithAddress(token);
      // A contact with no address at all. The manual-add API now requires an
      // address, so an unmailable contact is created straight through Prisma
      // (mirroring the permissive import-and-flag paths).
      const unmailable = await prisma.recipient.create({
        data: { accountId, firstName: "Sam", lastName: "Recipient" },
      });
      const noAddress = unmailable.id;

      const response = await request(app.getHttpServer())
        .post("/batch-orders/bulk-send")
        .set("Authorization", `Bearer ${token}`)
        .send({
          savedDesignId,
          recipientIds: [withAddress, noAddress],
          postageClass: "second_class",
        })
        .expect(400);
      expect((response.body as { message: string }).message).toContain("Sam Recipient");

      // Nothing was created — no order, and no stray occasions.
      expect(await prisma.batchOrder.count({ where: { accountId } })).toBe(0);
      expect(await prisma.occasion.count({ where: { accountId } })).toBe(0);
    });

    it("404s when a contact belongs to another account (nothing created)", async () => {
      const accountA = await signUp();
      const accountB = await signUp();
      const savedDesignId = await createSavedDesign(accountA.token);
      const mine = await createRecipientWithAddress(accountA.token);
      const theirs = await createRecipientWithAddress(accountB.token);

      await request(app.getHttpServer())
        .post("/batch-orders/bulk-send")
        .set("Authorization", `Bearer ${accountA.token}`)
        .send({ savedDesignId, recipientIds: [mine, theirs], postageClass: "second_class" })
        .expect(404);

      expect(await prisma.batchOrder.count({ where: { accountId: accountA.accountId } })).toBe(0);
      expect(await prisma.occasion.count({ where: { accountId: accountA.accountId } })).toBe(0);
    });

    it("enforces the plan's per-order cap", async () => {
      const { token, accountId } = await signUp();
      // Free plan allows 10 cards per order; ask for 11.
      const savedDesignId = await createSavedDesign(token);
      const recipientIds: string[] = [];
      for (let i = 0; i < 11; i += 1) {
        recipientIds.push(await createRecipientWithAddress(token));
      }

      await request(app.getHttpServer())
        .post("/batch-orders/bulk-send")
        .set("Authorization", `Bearer ${token}`)
        .send({ savedDesignId, recipientIds, postageClass: "second_class" })
        .expect(403);

      // The cap check fires inside create(), after the occasions are made, so a
      // rejected bulk send leaves no draft order behind.
      expect(await prisma.batchOrder.count({ where: { accountId } })).toBe(0);
    });
  });

  describe("preflight (bulk-send pre-send check)", () => {
    it("flags missing address + unresolved tokens and returns the exact price", async () => {
      const { token, accountId } = await signUp();
      const savedDesignId = await createSavedDesign(token);
      // Give the design a custom-field token only some recipients can resolve.
      await prisma.savedDesign.update({
        where: { id: savedDesignId },
        data: {
          document: {
            version: 1,
            pages: [
              {
                name: "front",
                elements: [{ id: "t1", kind: "text", text: "Dear {name}, from {teacher}" }],
              },
            ],
          },
        },
      });

      const clean = await prisma.recipient.create({
        data: {
          accountId,
          firstName: "Ada",
          lastName: "Clean",
          addressLine1: "1 Test St",
          addressCity: "London",
          addressPostcode: "SW1A 1AA",
          customFields: { teacher: "Mrs Smith" },
        },
      });
      const noToken = await prisma.recipient.create({
        data: {
          accountId,
          firstName: "Bo",
          lastName: "NoTeacher",
          addressLine1: "2 Test St",
          addressCity: "London",
          addressPostcode: "SW1A 1AA",
        },
      });
      const noAddress = await prisma.recipient.create({
        data: { accountId, firstName: "Cy", lastName: "NoAddress" },
      });

      const res = await request(app.getHttpServer())
        .post("/batch-orders/preflight")
        .set("Authorization", `Bearer ${token}`)
        .send({
          savedDesignId,
          recipientIds: [clean.id, noToken.id, noAddress.id],
          postageClass: "second_class",
        })
        .expect(201);
      const body = res.body as BatchOrderPreflight;

      expect(body.total).toBe(3);
      expect(body.ready).toBe(1);
      expect(body.missingAddress.count).toBe(1);
      expect(body.missingAddress.sample[0]!.name).toBe("Cy NoAddress");
      // Buckets overlap by design: a recipient can have more than one problem, and
      // each is reported so fixing one doesn't surprise the buyer with the next.
      // Cy has no address AND no {teacher} field, so it's flagged in both buckets —
      // hence two unresolved-token recipients (Bo and Cy), one missing address (Cy).
      expect(body.unresolvedTokens.count).toBe(2);
      const tokenNames = body.unresolvedTokens.sample.map((s) => s.name);
      expect(tokenNames).toContain("Bo NoTeacher");
      expect(tokenNames).toContain("Cy NoAddress");
      expect(body.unresolvedTokens.sample[0]!.detail).toContain("{teacher}");
      expect(body.invalidPostcode.count).toBe(0);
      expect(body.duplicate.count).toBe(0);
      // Price covers only the mailable cards — the set that will actually be
      // charged. Cy has no address, so it's Ada + Bo = 2 × (£2.50 + £0.91) 2nd
      // class = £6.82, not all three.
      expect(body.price.cardCount).toBe(2);
      expect(body.price.totalMinor).toBe(682);
    });

    it("flags a recent duplicate send of the same design", async () => {
      const { token, accountId } = await signUp();
      const savedDesignId = await createSavedDesign(token);
      const contact = await prisma.recipient.create({
        data: {
          accountId,
          firstName: "Dee",
          lastName: "Repeat",
          addressLine1: "3 Test St",
          addressCity: "London",
          addressPostcode: "SW1A 1AA",
        },
      });

      // A prior bulk-send of the same design to this contact — but only a draft,
      // not yet paid.
      const prior = await request(app.getHttpServer())
        .post("/batch-orders/bulk-send")
        .set("Authorization", `Bearer ${token}`)
        .send({ savedDesignId, recipientIds: [contact.id], postageClass: "second_class" })
        .expect(201);
      const priorOrderId = (prior.body as { id: string }).id;

      const preflight = () =>
        request(app.getHttpServer())
          .post("/batch-orders/preflight")
          .set("Authorization", `Bearer ${token}`)
          .send({ savedDesignId, recipientIds: [contact.id], postageClass: "second_class" })
          .expect(201);

      // An unpaid draft was never actually sent, so it must NOT flag as duplicate.
      const draftBody = (await preflight()).body as BatchOrderPreflight;
      expect(draftBody.duplicate.count).toBe(0);
      expect(draftBody.ready).toBe(1);

      // Once that order reaches payment, the same design to the same contact is a
      // genuine recent send and IS flagged.
      await prisma.batchOrder.update({
        where: { id: priorOrderId },
        data: { status: "paid" },
      });
      const paidBody = (await preflight()).body as BatchOrderPreflight;
      expect(paidBody.duplicate.count).toBe(1);
      expect(paidBody.duplicate.sample[0]!.name).toBe("Dee Repeat");
      expect(paidBody.ready).toBe(0);
    });
  });
});
