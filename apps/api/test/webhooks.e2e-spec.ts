import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { accountSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import Stripe from "stripe";
import { PrismaService } from "../src/prisma/prisma.service";
import type { EnvConfig } from "../src/config/env.schema";
import { EMAIL_CLIENT } from "../src/email/email.client";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * Builds the JSON envelope every Stripe event shares. Only `type` and
 * `data.object` vary per test — the server parses this as raw bytes and
 * re-derives the typed event itself, so this doesn't need to satisfy
 * Stripe's (much larger) TS Event type, just its real wire shape.
 */
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

describe("Webhooks (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let stripe: Stripe;
  let webhookSecret: string;
  let sendTransactional: jest.Mock;

  beforeAll(async () => {
    // No STRIPE_CLIENT override: webhooks.constructEvent/generateTestHeaderString
    // are pure local crypto, no network call, so the real Stripe SDK (built
    // from the placeholder test key) is safe to use as-is here. EMAIL_CLIENT is
    // mocked so the guest-receipt send is observable.
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

  function postWebhook(payload: string, secret: string = webhookSecret) {
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
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

  /** Creates a batch order in `pending_payment`, as if checkout() had already
   * run — without a real Stripe network call for the Checkout Session. */
  async function createPendingPaymentBatchOrder(
    token: string,
  ): Promise<{ batchOrderId: string; stripePaymentIntentId: string }> {
    const recipientId = await createRecipient(token);
    const savedDesignId = await createSavedDesign(token);
    const occasionResponse = await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "achievement", occasionDate: "2026-09-01", recipientId })
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
    const stripePaymentIntentId = `pi_test_${randomUUID()}`;

    await prisma.batchOrder.update({
      where: { id: batchOrderId },
      data: { status: "pending_payment", paymentMethod: "card", stripePaymentIntentId },
    });

    return { batchOrderId, stripePaymentIntentId };
  }

  it("rejects a webhook with an invalid signature", async () => {
    const payload = buildStripeEventPayload("checkout.session.completed", {
      id: "cs_test_bad_sig",
      metadata: {},
    });
    await postWebhook(payload, "whsec_wrong_secret").expect(400);
  });

  it("marks a batch order paid, queues its recipients, and creates fulfillment jobs", async () => {
    const { token } = await signUp();
    const { batchOrderId } = await createPendingPaymentBatchOrder(token);

    const payload = buildStripeEventPayload("checkout.session.completed", {
      id: `cs_test_${randomUUID()}`,
      metadata: { batchOrderId },
    });
    await postWebhook(payload).expect(201);

    const order = await prisma.batchOrder.findUniqueOrThrow({ where: { id: batchOrderId } });
    expect(order.status).toBe("paid");

    const orderRecipients = await prisma.orderRecipient.findMany({ where: { batchOrderId } });
    expect(orderRecipients).toHaveLength(1);
    expect(orderRecipients[0]?.status).toBe("queued");

    const fulfillmentJobs = await prisma.fulfillmentJob.findMany({
      where: { orderRecipientId: orderRecipients[0]!.id },
    });
    expect(fulfillmentJobs).toHaveLength(1);
    expect(fulfillmentJobs[0]?.status).toBe("pending");

    // Every paid card also gets an (empty) message page with a slug.
    const messagePage = await prisma.messagePage.findUnique({
      where: { orderRecipientId: orderRecipients[0]!.id },
    });
    expect(messagePage).not.toBeNull();
    expect(messagePage!.slug.length).toBeGreaterThanOrEqual(6);
    expect(messagePage!.message).toBeNull();
  });

  it("emails a guest buyer their claim link on payment, exactly once", async () => {
    const { token, accountId } = await signUp();
    const { batchOrderId } = await createPendingPaymentBatchOrder(token);
    // Make it a guest order: set a claim token + contact email on the account.
    const claimToken = `claim-${randomUUID()}`;
    await prisma.account.update({
      where: { id: accountId },
      data: { claimToken, contactEmail: "guest-buyer@example.com" },
    });
    sendTransactional.mockClear();

    const payload = buildStripeEventPayload("checkout.session.completed", {
      id: `cs_test_${randomUUID()}`,
      metadata: { batchOrderId },
    });
    await postWebhook(payload).expect(201);

    const calls = sendTransactional.mock.calls as Array<[{ to: string; html: string }]>;
    const receipt = calls.filter((call) => call[0]?.to === "guest-buyer@example.com");
    expect(receipt).toHaveLength(1);
    // The claim link (carrying the token) is in the email body.
    expect(receipt[0]?.[0]?.html).toContain(claimToken);

    // A redelivered event must NOT send a second receipt.
    sendTransactional.mockClear();
    await postWebhook(payload).expect(201);
    const resent = (sendTransactional.mock.calls as Array<[{ to: string }]>).filter(
      (call) => call[0]?.to === "guest-buyer@example.com",
    );
    expect(resent).toHaveLength(0);
  });

  it("is idempotent under Stripe's at-least-once redelivery", async () => {
    const { token } = await signUp();
    const { batchOrderId } = await createPendingPaymentBatchOrder(token);
    const payload = buildStripeEventPayload("checkout.session.completed", {
      id: `cs_test_${randomUUID()}`,
      metadata: { batchOrderId },
    });

    await postWebhook(payload).expect(201);
    await postWebhook(payload).expect(201);

    const orderRecipients = await prisma.orderRecipient.findMany({ where: { batchOrderId } });
    const fulfillmentJobs = await prisma.fulfillmentJob.findMany({
      where: { orderRecipientId: orderRecipients[0]!.id },
    });
    expect(fulfillmentJobs).toHaveLength(1);
  });

  it("audit-logs a failed payment without changing the batch order's status", async () => {
    const { token } = await signUp();
    const { batchOrderId, stripePaymentIntentId } = await createPendingPaymentBatchOrder(token);

    const payload = buildStripeEventPayload("payment_intent.payment_failed", {
      id: stripePaymentIntentId,
    });
    await postWebhook(payload).expect(201);

    const order = await prisma.batchOrder.findUniqueOrThrow({ where: { id: batchOrderId } });
    expect(order.status).toBe("pending_payment");

    const auditEntries = await prisma.auditLogEntry.findMany({
      where: { targetType: "BatchOrder", targetId: batchOrderId, action: "payment_failed" },
    });
    expect(auditEntries).toHaveLength(1);
  });

  it("upserts a Subscription and updates Account.planId on subscription events, reverting to free on cancellation", async () => {
    const { accountId } = await signUp();
    const stripeSubscriptionId = `sub_test_${randomUUID()}`;
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

    const activePayload = buildStripeEventPayload("customer.subscription.created", {
      id: stripeSubscriptionId,
      status: "active",
      metadata: { accountId, planId: "pro" },
      items: { data: [{ current_period_end: periodEnd }] },
    });
    await postWebhook(activePayload).expect(201);

    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { stripeSubscriptionId },
    });
    expect(subscription.status).toBe("active");
    expect(subscription.planId).toBe("pro");

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.planId).toBe("pro");

    const canceledPayload = buildStripeEventPayload("customer.subscription.deleted", {
      id: stripeSubscriptionId,
      status: "canceled",
      metadata: { accountId, planId: "pro" },
      items: { data: [{ current_period_end: periodEnd }] },
    });
    await postWebhook(canceledPayload).expect(201);

    const canceledSubscription = await prisma.subscription.findUniqueOrThrow({
      where: { stripeSubscriptionId },
    });
    expect(canceledSubscription.status).toBe("canceled");

    const revertedAccount = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(revertedAccount.planId).toBe("free");
  });

  it("releases an abandoned checkout back to draft on checkout.session.expired", async () => {
    const { token } = await signUp();
    const { batchOrderId } = await createPendingPaymentBatchOrder(token);

    const payload = buildStripeEventPayload("checkout.session.expired", {
      id: `cs_test_${randomUUID()}`,
      metadata: { batchOrderId },
    });
    await postWebhook(payload).expect(201);

    const order = await prisma.batchOrder.findUniqueOrThrow({ where: { id: batchOrderId } });
    expect(order.status).toBe("draft");
  });

  it("ignores an unrecognized Stripe event type", async () => {
    const payload = buildStripeEventPayload("customer.created", { id: "cus_test_irrelevant" });
    await postWebhook(payload).expect(201);
  });

  it("no-ops checkout.session.completed for a batchOrderId that doesn't exist", async () => {
    const payload = buildStripeEventPayload("checkout.session.completed", {
      id: `cs_test_${randomUUID()}`,
      metadata: { batchOrderId: randomUUID() },
    });
    await postWebhook(payload).expect(201);
  });

  it("no-ops a subscription event missing accountId/planId metadata", async () => {
    const payload = buildStripeEventPayload("customer.subscription.created", {
      id: `sub_test_${randomUUID()}`,
      status: "active",
      metadata: {},
      items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 1000 }] },
    });
    await postWebhook(payload).expect(201);
  });
});
