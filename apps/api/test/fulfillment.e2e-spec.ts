import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { accountSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import Stripe from "stripe";
import { PrismaService } from "../src/prisma/prisma.service";
import type { EnvConfig } from "../src/config/env.schema";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

function buildStripeEventPayload(type: string, dataObject: Record<string, unknown>): string {
  return JSON.stringify({
    id: `evt_${randomUUID()}`,
    object: "event",
    api_version: "2025-01-01",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type,
    data: { object: dataObject },
  });
}

interface PaidOrder {
  batchOrderId: string;
  occasionId: string;
  orderRecipientId: string;
  jobId: string;
}

describe("Fulfillment (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let stripe: Stripe;
  let webhookSecret: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const config = app.get(ConfigService<EnvConfig, true>);
    webhookSecret = config.get("STRIPE_WEBHOOK_SECRET", { infer: true });
    stripe = new Stripe(config.get("STRIPE_SECRET_KEY", { infer: true }));
  });

  afterAll(async () => {
    await app.close();
  });

  function postWebhook(payload: string) {
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    return request(app.getHttpServer())
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(payload);
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

  /** Mints a token for a fresh user and marks them a platform (ops) admin. */
  async function createOpsAdmin(): Promise<string> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId } });
    return mintToken(userId);
  }

  async function createPaidOrder(token: string): Promise<PaidOrder> {
    const recipientResponse = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Ada", lastName: "Lovelace" })
      .expect(201);
    const recipientId = (recipientResponse.body as { id: string }).id;

    const templatesResponse = await request(app.getHttpServer())
      .get("/card-designs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const cardDesignId = (templatesResponse.body as { id: string }[])[0]!.id;
    const designResponse = await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({ cardDesignId, name: "Test design" })
      .expect(201);
    const savedDesignId = (designResponse.body as { id: string }).id;

    const occasionResponse = await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "birthday", occasionDate: "2026-09-01", recipientId })
      .expect(201);
    const occasionId = (occasionResponse.body as { id: string }).id;
    await request(app.getHttpServer())
      .post(`/occasions/${occasionId}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ savedDesignId })
      .expect(201);

    const orderResponse = await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        lines: [
          {
            occasionId,
            shippingAddressLine1: "1 Test Street",
            shippingAddressCity: "London",
            shippingAddressPostcode: "SW1A 1AA",
            dispatchOption: "asap",
            postageClass: "first_class",
          },
        ],
      })
      .expect(201);
    const batchOrderId = (orderResponse.body as { id: string }).id;

    await prisma.batchOrder.update({
      where: { id: batchOrderId },
      data: { status: "pending_payment", paymentMethod: "card" },
    });
    await postWebhook(
      buildStripeEventPayload("checkout.session.completed", {
        id: `cs_test_${randomUUID()}`,
        metadata: { batchOrderId },
      }),
    ).expect(201);

    const orderRecipient = await prisma.orderRecipient.findFirstOrThrow({ where: { batchOrderId } });
    const job = await prisma.fulfillmentJob.findFirstOrThrow({
      where: { orderRecipientId: orderRecipient.id },
    });
    return { batchOrderId, occasionId, orderRecipientId: orderRecipient.id, jobId: job.id };
  }

  it("refuses a non-platform-admin (a normal customer) with 403", async () => {
    const { token } = await signUp();
    await request(app.getHttpServer())
      .get("/fulfillment/jobs")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
    await request(app.getHttpServer())
      .get("/fulfillment/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });

  it("lets a platform admin see pending jobs across different accounts", async () => {
    const opsToken = await createOpsAdmin();
    const accountA = await signUp();
    const accountB = await signUp();
    const orderA = await createPaidOrder(accountA.token);
    const orderB = await createPaidOrder(accountB.token);

    await request(app.getHttpServer())
      .get("/fulfillment/me")
      .set("Authorization", `Bearer ${opsToken}`)
      .expect(200);

    const response = await request(app.getHttpServer())
      .get("/fulfillment/jobs?status=pending&perPage=100")
      .set("Authorization", `Bearer ${opsToken}`)
      .expect(200);
    const ids = (response.body as { items: { id: string }[] }).items.map((j) => j.id);
    expect(ids).toEqual(expect.arrayContaining([orderA.jobId, orderB.jobId]));
  });

  it("runs a job through the full lifecycle and propagates each step", async () => {
    const opsToken = await createOpsAdmin();
    const { token } = await signUp();
    const order = await createPaidOrder(token);

    // claim: pending -> in_progress
    await request(app.getHttpServer())
      .post(`/fulfillment/jobs/${order.jobId}/claim`)
      .set("Authorization", `Bearer ${opsToken}`)
      .expect(201);

    const transition = (toStatus: string, body: Record<string, unknown> = {}) =>
      request(app.getHttpServer())
        .post(`/fulfillment/jobs/${order.jobId}/transition`)
        .set("Authorization", `Bearer ${opsToken}`)
        .send({ toStatus, ...body })
        .expect(201);

    await transition("printed");
    let occasion = await prisma.occasion.findUniqueOrThrow({ where: { id: order.occasionId } });
    let orderRecipient = await prisma.orderRecipient.findUniqueOrThrow({
      where: { id: order.orderRecipientId },
    });
    let batchOrder = await prisma.batchOrder.findUniqueOrThrow({ where: { id: order.batchOrderId } });
    expect(occasion.status).toBe("printed");
    expect(orderRecipient.status).toBe("printed");
    expect(batchOrder.status).toBe("fulfilling"); // first card printed -> order fulfilling

    await transition("posted", { trackingReference: "RM123456789GB" });
    orderRecipient = await prisma.orderRecipient.findUniqueOrThrow({
      where: { id: order.orderRecipientId },
    });
    const job = await prisma.fulfillmentJob.findUniqueOrThrow({ where: { id: order.jobId } });
    expect(orderRecipient.status).toBe("posted");
    expect(job.trackingReference).toBe("RM123456789GB");
    expect(job.postedAt).not.toBeNull();

    await transition("delivered");
    occasion = await prisma.occasion.findUniqueOrThrow({ where: { id: order.occasionId } });
    batchOrder = await prisma.batchOrder.findUniqueOrThrow({ where: { id: order.batchOrderId } });
    expect(occasion.status).toBe("delivered");
    expect(batchOrder.status).toBe("completed"); // only card delivered -> order completed
  });

  it("rejects an out-of-order transition", async () => {
    const opsToken = await createOpsAdmin();
    const { token } = await signUp();
    const order = await createPaidOrder(token);

    // pending -> posted skips printed
    await request(app.getHttpServer())
      .post(`/fulfillment/jobs/${order.jobId}/transition`)
      .set("Authorization", `Bearer ${opsToken}`)
      .send({ toStatus: "posted" })
      .expect(409);
  });

  it("lets only one of two concurrent claims win", async () => {
    const opsToken = await createOpsAdmin();
    const { token } = await signUp();
    const order = await createPaidOrder(token);

    const results = await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer())
          .post(`/fulfillment/jobs/${order.jobId}/claim`)
          .set("Authorization", `Bearer ${opsToken}`),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it("bulk-transitions a print run, skipping jobs not in a valid state", async () => {
    const opsToken = await createOpsAdmin();
    const { token } = await signUp();
    const orderA = await createPaidOrder(token);
    const orderB = await createPaidOrder(token);

    // Move orderA all the way to delivered so it's not a valid target for printed.
    for (const toStatus of ["printed", "posted", "delivered"]) {
      await request(app.getHttpServer())
        .post(`/fulfillment/jobs/${orderA.jobId}/transition`)
        .set("Authorization", `Bearer ${opsToken}`)
        .send({ toStatus })
        .expect(201);
    }

    const response = await request(app.getHttpServer())
      .post("/fulfillment/jobs/bulk-transition")
      .set("Authorization", `Bearer ${opsToken}`)
      .send({ jobIds: [orderA.jobId, orderB.jobId], toStatus: "printed" })
      .expect(201);
    expect(response.body).toEqual({ transitioned: 1, skipped: 1 });

    const jobB = await prisma.fulfillmentJob.findUniqueOrThrow({ where: { id: orderB.jobId } });
    expect(jobB.status).toBe("printed");
  });
});
