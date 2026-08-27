import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { App } from "supertest/types";
import request from "supertest";
import Stripe from "stripe";
import { addWorkingDays, startOfUtcDay } from "@kudos/shared-types";
import { PrismaService } from "../src/prisma/prisma.service";
import type { EnvConfig } from "../src/config/env.schema";
import { EMAIL_CLIENT } from "../src/email/email.client";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * The estimated-arrival notification flow (ADR 0124). Cards ship on untracked
 * stamps, so we estimate arrival from postedAt + the postage class's transit and,
 * once passed, mark the card delivered (estimated) + email the buyer. Exercised
 * against a MOCKED email client — no real send. Time is controlled by backdating
 * `postedAt` directly.
 */
describe("Arrival notification (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let stripe: Stripe;
  let webhookSecret: string;
  let sendTransactional: jest.Mock;

  beforeAll(async () => {
    sendTransactional = jest.fn().mockResolvedValue(undefined);
    app = await createTestApp([{ provide: EMAIL_CLIENT, useValue: { sendTransactional } }]);
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

  /** Full paid order → one fulfillment job, marked posted (postedAt = now). */
  async function createPostedJob(token: string, ops: string): Promise<string> {
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
        data: {
          object: {
            id: `cs_test_${randomUUID()}`,
            payment_status: "paid",
            metadata: { batchOrderId },
          },
        },
      }),
    ).expect(201);

    const orderRecipient = await prisma.orderRecipient.findFirstOrThrow({
      where: { batchOrderId },
    });
    const job = await prisma.fulfillmentJob.findFirstOrThrow({
      where: { orderRecipientId: orderRecipient.id },
    });
    // pending → printed → posted (posted stamps postedAt = now).
    await request(app.getHttpServer())
      .post(`/fulfillment/jobs/${job.id}/transition`)
      .set("Authorization", `Bearer ${ops}`)
      .send({ toStatus: "printed" })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/fulfillment/jobs/${job.id}/transition`)
      .set("Authorization", `Bearer ${ops}`)
      .send({ toStatus: "posted" })
      .expect(201);
    return job.id;
  }

  /** Backdate a job's postedAt to N calendar days ago. */
  async function backdatePosted(jobId: string, daysAgo: number): Promise<void> {
    const postedAt = new Date();
    postedAt.setUTCDate(postedAt.getUTCDate() - daysAgo);
    await prisma.fulfillmentJob.update({ where: { id: jobId }, data: { postedAt } });
  }

  it("marks a past-transit posted card delivered (estimated) and emails the buyer once", async () => {
    const ops = await createOpsAdmin();
    const token = await signUp();
    const jobId = await createPostedJob(token, ops);
    await backdatePosted(jobId, 10); // well past 1st-class transit
    const posted = await prisma.fulfillmentJob.findUniqueOrThrow({ where: { id: jobId } });
    const expectedArrival = addWorkingDays(startOfUtcDay(posted.postedAt!), 1); // 1st class default = 1
    sendTransactional.mockClear();

    const res = await request(app.getHttpServer())
      .post("/fulfillment/notify-arrivals")
      .set("Authorization", `Bearer ${ops}`)
      .expect(201);
    expect(res.body).toMatchObject({ notified: 1 });

    const stored = await prisma.fulfillmentJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(stored.status).toBe("delivered");
    // deliveredAt is the ESTIMATE (posting + transit), not "now".
    expect(stored.deliveredAt?.toISOString()).toBe(expectedArrival.toISOString());

    // The order rolled up to completed, and the buyer got an honest arrival email.
    const orderRecipient = await prisma.orderRecipient.findFirstOrThrow({
      where: { fulfillmentJob: { id: jobId } },
    });
    const order = await prisma.batchOrder.findUniqueOrThrow({
      where: { id: orderRecipient.batchOrderId },
    });
    expect(order.status).toBe("completed");
    expect(sendTransactional).toHaveBeenCalledTimes(1);
    const email = (sendTransactional.mock.calls as { subject: string }[][])[0]![0]!;
    expect(email.subject).toMatch(/should have arrived/i);

    // Marked against the system arrival actor.
    const audit = await prisma.auditLogEntry.findFirstOrThrow({
      where: { targetId: jobId, action: "fulfillment_delivered" },
    });
    expect(audit.actorUserId).toBe("system:arrival-estimate");

    // A second sweep is a no-op — the card is no longer posted.
    sendTransactional.mockClear();
    const again = await request(app.getHttpServer())
      .post("/fulfillment/notify-arrivals")
      .set("Authorization", `Bearer ${ops}`)
      .expect(201);
    expect(again.body).toMatchObject({ notified: 0 });
    expect(sendTransactional).not.toHaveBeenCalled();
  });

  it("leaves a just-posted card alone (not yet due to have arrived)", async () => {
    const ops = await createOpsAdmin();
    const token = await signUp();
    const jobId = await createPostedJob(token, ops); // postedAt = now
    sendTransactional.mockClear();

    const res = await request(app.getHttpServer())
      .post("/fulfillment/notify-arrivals")
      .set("Authorization", `Bearer ${ops}`)
      .expect(201);
    expect(res.body).toMatchObject({ notified: 0 });

    const stored = await prisma.fulfillmentJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(stored.status).toBe("posted");
    expect(sendTransactional).not.toHaveBeenCalled();
  });

  it("skips an old backlog card posted beyond the recency window", async () => {
    const ops = await createOpsAdmin();
    const token = await signUp();
    const jobId = await createPostedJob(token, ops);
    await backdatePosted(jobId, 30); // beyond the 14-day default window
    sendTransactional.mockClear();

    const res = await request(app.getHttpServer())
      .post("/fulfillment/notify-arrivals")
      .set("Authorization", `Bearer ${ops}`)
      .expect(201);
    expect(res.body).toMatchObject({ notified: 0 });

    const stored = await prisma.fulfillmentJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(stored.status).toBe("posted");
    expect(sendTransactional).not.toHaveBeenCalled();
  });

  it("requires platform-admin auth", async () => {
    const token = await signUp();
    await request(app.getHttpServer())
      .post("/fulfillment/notify-arrivals")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });
});
