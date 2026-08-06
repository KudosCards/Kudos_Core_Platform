import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { App } from "supertest/types";
import request from "supertest";
import Stripe from "stripe";
import { PrismaService } from "../src/prisma/prisma.service";
import type { EnvConfig } from "../src/config/env.schema";
import { EMAIL_CLIENT } from "../src/email/email.client";
import { ROYAL_MAIL_CLIENT } from "../src/shipping/royal-mail-client.provider";
import type { TrackingStatusResult } from "../src/shipping/royal-mail-client";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * The automated delivery-registration flow (ADR 0121), exercised against a
 * MOCKED Royal Mail client — no test hits the real tracking API. Cards are
 * dispatched to `posted` (with a tracking number) and the poll then advances the
 * ones the carrier reports delivered, exactly like the hourly cron.
 */
describe("Delivery poll (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let stripe: Stripe;
  let webhookSecret: string;
  let createShipment: jest.Mock;
  let getTrackingStatus: jest.Mock;

  beforeAll(async () => {
    createShipment = jest.fn(() =>
      Promise.resolve({ trackingNumber: `RM${Date.now() % 1_000_000}GB`, labelUrl: null }),
    );
    // Default: nothing delivered. Individual tests override per tracking number.
    getTrackingStatus = jest.fn(
      (): Promise<TrackingStatusResult> =>
        Promise.resolve({ status: "in_transit", deliveredAt: null, rawStatus: "In transit" }),
    );
    app = await createTestApp([
      { provide: EMAIL_CLIENT, useValue: { sendTransactional: jest.fn().mockResolvedValue(undefined) } },
      { provide: ROYAL_MAIL_CLIENT, useValue: { enabled: true, createShipment, getTrackingStatus } },
    ]);
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

  async function signUp(): Promise<string> {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Test Centre ${randomUUID()}` })
      .expect(201);
    return token;
  }

  async function createOpsAdmin(): Promise<string> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId } });
    return mintToken(userId);
  }

  /** Full paid order → one fulfillment job, dispatched to `posted` with a tracking
   * number (the state the delivery poll acts on). Returns the job id + tracking. */
  async function createPostedJob(
    token: string,
    ops: string,
  ): Promise<{ jobId: string; trackingReference: string }> {
    const recipient = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Ada",
        lastName: "Lovelace",
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
      })
      .expect(201);
    const recipientId = (recipient.body as { id: string }).id;

    const templates = await request(app.getHttpServer())
      .get("/card-designs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const cardDesignId = (templates.body as { id: string }[])[0]!.id;
    const design = await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({ cardDesignId, name: "Test design" })
      .expect(201);
    const savedDesignId = (design.body as { id: string }).id;

    const occasion = await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "birthday", occasionDate: "2026-09-01", recipientId })
      .expect(201);
    const occasionId = (occasion.body as { id: string }).id;
    await request(app.getHttpServer())
      .post(`/occasions/${occasionId}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ savedDesignId })
      .expect(201);

    const order = await request(app.getHttpServer())
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
    const batchOrderId = (order.body as { id: string }).id;

    await prisma.batchOrder.update({
      where: { id: batchOrderId },
      data: { status: "pending_payment", paymentMethod: "card" },
    });
    await postWebhook(
      JSON.stringify({
        id: `evt_${randomUUID()}`,
        object: "event",
        type: "checkout.session.completed",
        data: { object: { id: `cs_test_${randomUUID()}`, metadata: { batchOrderId } } },
      }),
    ).expect(201);

    const orderRecipient = await prisma.orderRecipient.findFirstOrThrow({ where: { batchOrderId } });
    const job = await prisma.fulfillmentJob.findFirstOrThrow({
      where: { orderRecipientId: orderRecipient.id },
    });
    // pending → printed → dispatch (posts + allocates tracking via the mock).
    await request(app.getHttpServer())
      .post(`/fulfillment/jobs/${job.id}/transition`)
      .set("Authorization", `Bearer ${ops}`)
      .send({ toStatus: "printed" })
      .expect(201);
    const dispatched = await request(app.getHttpServer())
      .post(`/fulfillment/jobs/${job.id}/dispatch`)
      .set("Authorization", `Bearer ${ops}`)
      .expect(201);
    const trackingReference = (dispatched.body as { trackingReference: string }).trackingReference;
    return { jobId: job.id, trackingReference };
  }

  it("advances a posted card to delivered when the carrier reports delivery, stamping the carrier time", async () => {
    const ops = await createOpsAdmin();
    const token = await signUp();
    const { jobId, trackingReference } = await createPostedJob(token, ops);

    const deliveredAt = "2026-08-05T09:14:00.000Z";
    getTrackingStatus.mockImplementation((tn: string) =>
      Promise.resolve<TrackingStatusResult>(
        tn === trackingReference
          ? { status: "delivered", deliveredAt: new Date(deliveredAt), rawStatus: "Delivered" }
          : { status: "in_transit", deliveredAt: null, rawStatus: "In transit" },
      ),
    );

    const response = await request(app.getHttpServer())
      .post("/fulfillment/poll-deliveries")
      .set("Authorization", `Bearer ${ops}`)
      .expect(201);
    expect(response.body).toMatchObject({ delivered: 1, failed: 0 });

    const stored = await prisma.fulfillmentJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(stored.status).toBe("delivered");
    expect(stored.deliveredAt?.toISOString()).toBe(deliveredAt);

    // The order rolls up to completed once its only card is delivered.
    const orderRecipient = await prisma.orderRecipient.findFirstOrThrow({
      where: { fulfillmentJob: { id: jobId } },
    });
    const batchOrder = await prisma.batchOrder.findUniqueOrThrow({
      where: { id: orderRecipient.batchOrderId },
    });
    expect(batchOrder.status).toBe("completed");

    // The transition was recorded against the delivery-poll system actor.
    const audit = await prisma.auditLogEntry.findFirstOrThrow({
      where: { targetId: jobId, action: "fulfillment_delivered" },
    });
    expect(audit.actorUserId).toBe("system:delivery-poll");
  });

  it("leaves a still-in-transit card posted", async () => {
    const ops = await createOpsAdmin();
    const token = await signUp();
    const { jobId } = await createPostedJob(token, ops);
    getTrackingStatus.mockResolvedValue({
      status: "in_transit",
      deliveredAt: null,
      rawStatus: "In transit",
    });

    await request(app.getHttpServer())
      .post("/fulfillment/poll-deliveries")
      .set("Authorization", `Bearer ${ops}`)
      .expect(201);

    const stored = await prisma.fulfillmentJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(stored.status).toBe("posted");
    expect(stored.deliveredAt).toBeNull();
  });

  it("counts a tracking-lookup error as failed and leaves the card posted", async () => {
    const ops = await createOpsAdmin();
    const token = await signUp();
    const { jobId, trackingReference } = await createPostedJob(token, ops);
    getTrackingStatus.mockImplementation((tn: string) =>
      tn === trackingReference
        ? Promise.reject(new Error("carrier 500"))
        : Promise.resolve<TrackingStatusResult>({
            status: "in_transit",
            deliveredAt: null,
            rawStatus: "In transit",
          }),
    );

    const response = await request(app.getHttpServer())
      .post("/fulfillment/poll-deliveries")
      .set("Authorization", `Bearer ${ops}`)
      .expect(201);
    expect((response.body as { failed: number }).failed).toBeGreaterThanOrEqual(1);

    const stored = await prisma.fulfillmentJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(stored.status).toBe("posted");
  });

  it("requires platform-admin auth", async () => {
    const token = await signUp();
    await request(app.getHttpServer())
      .post("/fulfillment/poll-deliveries")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });
});
