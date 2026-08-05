import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema, startOfUtcDay, type BatchOrderPreflight } from "@kudos/shared-types";
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

const paginatedBatchOrdersSchema = z.object({
  items: z.array(batchOrderSchema),
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

  beforeAll(async () => {
    checkoutSessionsCreate = jest.fn();
    const mockStripe = {
      checkout: { sessions: { create: checkoutSessionsCreate } },
    } as unknown as Stripe;

    app = await createTestApp([{ provide: STRIPE_CLIENT, useValue: mockStripe }]);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    checkoutSessionsCreate.mockReset();
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

  it("rejects checking out a non-draft batch order", async () => {
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

    await request(app.getHttpServer())
      .post(`/batch-orders/${order.id}/checkout`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);
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

    it("retains the birthday classification (and dates the send to today) when sending via a reconciled occasion", async () => {
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

      // The created send occasion inherits the birthday *classification* (not a
      // bespoke event) and supersedes the natural one. Its own date stays the
      // send moment — the unique (recipient, type, occasionDate) index means we
      // can't put a second birthday occasion on the birthday's own date, which
      // the natural one already holds. And, being an asap send paid now, it
      // dispatches TODAY, so it never reads as overdue.
      const sent = await prisma.occasion.findFirstOrThrow({
        where: { accountId, source: "one_off_campaign" },
      });
      expect(sent.type).toBe("birthday");
      expect(sent.supersedesOccasionId).toBe(birthday.id);
      expect(sent.dispatchDate?.getTime()).toBe(startOfUtcDay(new Date()).getTime());
      // Dated to the send moment (today), not the future birthday.
      expect(sent.occasionDate.getTime()).toBeGreaterThanOrEqual(
        startOfUtcDay(new Date()).getTime(),
      );
      expect(sent.occasionDate.getTime()).not.toBe(birthday.occasionDate.getTime());
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
