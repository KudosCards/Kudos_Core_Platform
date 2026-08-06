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
import type { CreateShipmentInput } from "../src/shipping/royal-mail-client";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * The Royal Mail dispatch flow, exercised against a MOCKED shipping client (the
 * ROYAL_MAIL_CLIENT provider is overridden) — no test ever hits the real Royal
 * Mail API, exactly like the Stripe/Airtable e2e overrides.
 */
describe("Royal Mail dispatch (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let stripe: Stripe;
  let webhookSecret: string;
  let sendTransactional: jest.Mock;
  let createShipment: jest.Mock;

  beforeAll(async () => {
    sendTransactional = jest.fn().mockResolvedValue(undefined);
    createShipment = jest.fn((input: CreateShipmentInput) =>
      Promise.resolve({
        trackingNumber: `RM${input.postcode.replace(/\s/g, "")}${Date.now() % 100000}`,
        labelUrl: "https://labels.example.com/label.pdf",
      }),
    );
    app = await createTestApp([
      { provide: EMAIL_CLIENT, useValue: { sendTransactional } },
      { provide: ROYAL_MAIL_CLIENT, useValue: { enabled: true, createShipment } },
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

  /** Full paid order → one fulfillment job, returned already moved to `printed`
   * (the state dispatch requires). */
  async function createPrintedJob(token: string): Promise<string> {
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
          object: { id: `cs_test_${randomUUID()}`, payment_status: "paid", metadata: { batchOrderId } },
        },
      }),
    ).expect(201);

    const orderRecipient = await prisma.orderRecipient.findFirstOrThrow({ where: { batchOrderId } });
    const job = await prisma.fulfillmentJob.findFirstOrThrow({
      where: { orderRecipientId: orderRecipient.id },
    });
    // Move pending → printed so it's dispatchable.
    const ops = await createOpsAdmin();
    await request(app.getHttpServer())
      .post(`/fulfillment/jobs/${job.id}/transition`)
      .set("Authorization", `Bearer ${ops}`)
      .send({ toStatus: "printed" })
      .expect(201);
    return job.id;
  }

  it("reports that shipping automation is enabled", async () => {
    const ops = await createOpsAdmin();
    const response = await request(app.getHttpServer())
      .get("/fulfillment/shipping-status")
      .set("Authorization", `Bearer ${ops}`)
      .expect(200);
    expect(response.body).toEqual({ enabled: true });
  });

  it("dispatches a printed card: creates a shipment, stores tracking + label, marks posted", async () => {
    const ops = await createOpsAdmin();
    const token = await signUp();
    const jobId = await createPrintedJob(token);
    createShipment.mockClear();
    sendTransactional.mockClear();

    const response = await request(app.getHttpServer())
      .post(`/fulfillment/jobs/${jobId}/dispatch`)
      .set("Authorization", `Bearer ${ops}`)
      .expect(201);

    // The shipping client was called with the card's real address + postage.
    expect(createShipment).toHaveBeenCalledTimes(1);
    const shipmentInput = (createShipment.mock.calls as CreateShipmentInput[][])[0]![0]!;
    expect(shipmentInput).toMatchObject({
      recipientName: "Ada Lovelace",
      addressLine1: "1 Test Street",
      city: "London",
      postcode: "SW1A 1AA",
      postageClass: "first_class",
    });
    expect(shipmentInput.orderReference).toMatch(/^ORD-\d+$/);

    // The job is posted with the tracking reference + label persisted.
    const body = response.body as { status: string; trackingReference: string; labelUrl: string };
    expect(body.status).toBe("posted");
    expect(body.trackingReference).toMatch(/^RM/);
    const stored = await prisma.fulfillmentJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(stored.status).toBe("posted");
    expect(stored.trackingReference).toBe(body.trackingReference);
    expect(stored.labelUrl).toBe("https://labels.example.com/label.pdf");
    expect(stored.postedAt).not.toBeNull();

    // The buyer got a dispatch email that carries the tracking number.
    expect(sendTransactional).toHaveBeenCalledTimes(1);
    const email = (
      sendTransactional.mock.calls as {
        html: string;
        params: { tracking: { trackingReference: string }[] };
      }[][]
    )[0]![0]!;
    expect(email.html).toContain(body.trackingReference);
    expect(email.params.tracking[0]!.trackingReference).toBe(body.trackingReference);
  });

  it("refuses to dispatch a card that hasn't been printed yet (409)", async () => {
    const ops = await createOpsAdmin();
    const token = await signUp();
    // A brand-new paid job is `pending`, not `printed`.
    const recipient = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Grace",
        lastName: "Hopper",
        addressLine1: "2 Test Street",
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
      .send({ cardDesignId, name: "D" })
      .expect(201);
    const savedDesignId = (design.body as { id: string }).id;
    const occasion = await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "birthday", occasionDate: "2026-09-02", recipientId })
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
            shippingAddressLine1: "2 Test Street",
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
          object: { id: `cs_test_${randomUUID()}`, payment_status: "paid", metadata: { batchOrderId } },
        },
      }),
    ).expect(201);
    const orderRecipient = await prisma.orderRecipient.findFirstOrThrow({ where: { batchOrderId } });
    const job = await prisma.fulfillmentJob.findFirstOrThrow({
      where: { orderRecipientId: orderRecipient.id },
    });

    await request(app.getHttpServer())
      .post(`/fulfillment/jobs/${job.id}/dispatch`)
      .set("Authorization", `Bearer ${ops}`)
      .expect(409);
  });

  it("bulk-dispatches a print run and reports how many shipped", async () => {
    const ops = await createOpsAdmin();
    const token = await signUp();
    const a = await createPrintedJob(token);
    const b = await createPrintedJob(token);

    const response = await request(app.getHttpServer())
      .post("/fulfillment/jobs/dispatch")
      .set("Authorization", `Bearer ${ops}`)
      .send({ jobIds: [a, b] })
      .expect(201);
    expect(response.body).toEqual({ dispatched: 2, failed: 0 });
  });

  it("requires platform-admin auth", async () => {
    const token = await signUp();
    await request(app.getHttpServer())
      .get("/fulfillment/shipping-status")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });
});
