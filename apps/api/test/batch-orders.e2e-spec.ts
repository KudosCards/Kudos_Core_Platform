import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema } from "@kudos/shared-types";
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
      .send({ firstName: "Sam", lastName: "Recipient" })
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
    expect(order.subtotalMinor).toBe(150);
    expect(order.totalMinor).toBe(150);
    expect(order.orderRecipients).toHaveLength(1);
    expect(order.orderRecipients[0]?.priceMinor).toBe(150);
    expect(order.orderRecipients[0]?.status).toBe("approved");

    const occasion = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
    expect(occasion.status).toBe("queued");
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
    for (let i = 0; i < 21; i += 1) {
      occasionIds.push(await createApprovedOccasion(token));
    }

    // Exactly at the free plan's batchOrderMaxSize (20, per seed.ts) — the
    // boundary itself must succeed, not just fail one-over-the-limit.
    await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ lines: occasionIds.slice(0, 20).map(buildLine) })
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
    expect(sessionArgs.line_items?.[0]?.price_data?.unit_amount).toBe(150);

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
});
