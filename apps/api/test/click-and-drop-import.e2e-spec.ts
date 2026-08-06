import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { App } from "supertest/types";
import request from "supertest";
import Stripe from "stripe";
import { PrismaService } from "../src/prisma/prisma.service";
import type { EnvConfig } from "../src/config/env.schema";
import { CLICK_AND_DROP_CLIENT } from "../src/shipping/click-and-drop-client.provider";
import { ClickAndDropService } from "../src/shipping/click-and-drop.service";
import type { ClickAndDropOrderInput } from "../src/shipping/click-and-drop-client";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * The Click & Drop order-import flow, exercised against a MOCKED Click & Drop
 * client (the CLICK_AND_DROP_CLIENT provider is overridden) — no test ever hits
 * the real Royal Mail API, exactly like the Stripe/Royal-Mail/Airtable overrides.
 * The background sweep is invoked directly (not waited on) so the tests are
 * deterministic.
 */
describe("Click & Drop import (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let stripe: Stripe;
  let webhookSecret: string;
  let createOrder: jest.Mock;
  let service: ClickAndDropService;

  beforeAll(async () => {
    createOrder = jest.fn((input: ClickAndDropOrderInput) =>
      Promise.resolve({ orderIdentifier: `cnd_${input.orderReference}` }),
    );
    app = await createTestApp([
      { provide: CLICK_AND_DROP_CLIENT, useValue: { enabled: true, createOrder } },
    ]);
    prisma = app.get(PrismaService);
    service = app.get(ClickAndDropService);
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

  /** Full paid order → one pending fulfillment job (not yet imported). */
  async function createPaidJob(token: string): Promise<string> {
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

    const orderRecipient = await prisma.orderRecipient.findFirstOrThrow({
      where: { batchOrderId },
    });
    const job = await prisma.fulfillmentJob.findFirstOrThrow({
      where: { orderRecipientId: orderRecipient.id },
    });
    return job.id;
  }

  it("reports that Click & Drop import is enabled", async () => {
    const ops = await createOpsAdmin();
    const response = await request(app.getHttpServer())
      .get("/fulfillment/click-and-drop-status")
      .set("Authorization", `Bearer ${ops}`)
      .expect(200);
    expect(response.body).toEqual({ enabled: true });
  });

  it("sweep imports a paid card with its address + postage, stores the order id, and is idempotent", async () => {
    const token = await signUp();
    const jobId = await createPaidJob(token);
    createOrder.mockClear();

    const first = await service.sweep();
    expect(first.imported).toBeGreaterThanOrEqual(1);

    // The sweep is global, so it may also import paid jobs left by earlier
    // suites in the shared test DB — scope the assertion to THIS job via its
    // stored order id rather than the first "ORD-" call the mock happened to see.
    const stored = await prisma.fulfillmentJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(stored.clickAndDropError).toBeNull();
    expect(stored.clickAndDropOrderId).toMatch(/^cnd_ORD-\d+-[0-9a-f]{8}$/);

    const orderReference = stored.clickAndDropOrderId!.slice("cnd_".length);
    const call = (createOrder.mock.calls as ClickAndDropOrderInput[][]).find(
      (c) => c[0]!.orderReference === orderReference,
    )![0]!;
    expect(call).toMatchObject({
      recipientName: "Ada Lovelace",
      addressLine1: "1 Test Street",
      city: "London",
      postcode: "SW1A 1AA",
      postageClass: "first_class",
    });

    // A second sweep must not re-import an already-imported card.
    createOrder.mockClear();
    await service.sweep();
    const reimported = (createOrder.mock.calls as ClickAndDropOrderInput[][]).some(
      (c) => c[0]!.orderReference === call.orderReference,
    );
    expect(reimported).toBe(false);
  });

  it("records the error on a failed push and imports on a manual retry", async () => {
    const ops = await createOpsAdmin();
    const token = await signUp();
    const jobId = await createPaidJob(token);

    // Fail the next push for this card only.
    createOrder.mockImplementationOnce(() => Promise.reject(new Error("RM 400: bad postcode")));
    await service.sweep();

    let stored = await prisma.fulfillmentJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(stored.clickAndDropOrderId).toBeNull();
    expect(stored.clickAndDropError).toContain("bad postcode");

    // Manual retry succeeds (createOrder resolves again) and clears the error.
    const response = await request(app.getHttpServer())
      .post(`/fulfillment/jobs/${jobId}/click-and-drop`)
      .set("Authorization", `Bearer ${ops}`)
      .expect(201);
    expect((response.body as { clickAndDropOrderId: string }).clickAndDropOrderId).toMatch(/^cnd_/);

    stored = await prisma.fulfillmentJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(stored.clickAndDropOrderId).not.toBeNull();
    expect(stored.clickAndDropError).toBeNull();
  });

  it("requires platform-admin auth for the retry endpoint", async () => {
    const token = await signUp();
    const jobId = await createPaidJob(token);
    await request(app.getHttpServer())
      .post(`/fulfillment/jobs/${jobId}/click-and-drop`)
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });

  it("import-status readout bands a card as imported with a searchable reference", async () => {
    const ops = await createOpsAdmin();
    const token = await signUp();
    const jobId = await createPaidJob(token);
    createOrder.mockClear();
    await service.sweep();

    const stored = await prisma.fulfillmentJob.findUniqueOrThrow({ where: { id: jobId } });
    const response = await request(app.getHttpServer())
      .get("/fulfillment/click-and-drop/import-status")
      .set("Authorization", `Bearer ${ops}`)
      .expect(200);
    const status = response.body as {
      enabled: boolean;
      imported: number;
      errored: number;
      awaiting: number;
      recentImports: {
        jobId: string;
        orderReference: string;
        orderIdentifier: string | null;
        importedAt: string | null;
      }[];
    };

    expect(status.enabled).toBe(true);
    expect(status.imported).toBeGreaterThanOrEqual(1);
    // The reference we surface for confirming in the dashboard is exactly the one
    // the sweep sent (the stored id is `cnd_<reference>` in this mock).
    const sample = status.recentImports.find((s) => s.jobId === jobId);
    expect(sample).toBeDefined();
    expect(sample!.orderReference).toMatch(/^ORD-\d+-[0-9a-f]{8}$/);
    expect(stored.clickAndDropOrderId).toBe(`cnd_${sample!.orderReference}`);
    // The precise import timestamp is stored and surfaced (not a proxy).
    expect(stored.clickAndDropImportedAt).not.toBeNull();
    expect(sample!.importedAt).toBe(stored.clickAndDropImportedAt!.toISOString());
  });

  it("import-status readout bands a failed card as errored with its message", async () => {
    const ops = await createOpsAdmin();
    const token = await signUp();
    const jobId = await createPaidJob(token);

    createOrder.mockImplementationOnce(() => Promise.reject(new Error("RM 400: bad postcode")));
    await service.sweep();

    const response = await request(app.getHttpServer())
      .get("/fulfillment/click-and-drop/import-status")
      .set("Authorization", `Bearer ${ops}`)
      .expect(200);
    const status = response.body as {
      errored: number;
      recentErrors: { jobId: string; orderReference: string; error: string | null }[];
    };

    expect(status.errored).toBeGreaterThanOrEqual(1);
    const sample = status.recentErrors.find((s) => s.jobId === jobId);
    expect(sample).toBeDefined();
    expect(sample!.error).toContain("bad postcode");
  });

  it("requires platform-admin auth for the import-status readout", async () => {
    const token = await signUp();
    await request(app.getHttpServer())
      .get("/fulfillment/click-and-drop/import-status")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });
});
