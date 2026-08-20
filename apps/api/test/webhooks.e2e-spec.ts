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
function buildStripeEventPayload(
  type: string,
  dataObject: Record<string, unknown>,
  // event.created (epoch seconds). Defaults to now; a test overrides it to model
  // an out-of-order / replayed delivery, which the subscription handler orders on.
  createdSeconds: number = Math.floor(Date.now() / 1000),
): string {
  return JSON.stringify({
    id: `evt_${randomUUID()}`,
    object: "event",
    api_version: "2025-01-01",
    created: createdSeconds,
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type,
    // A real checkout.session.completed / async_payment_succeeded always carries
    // a payment_status; default it to "paid" so card-payment fixtures settle,
    // while a test can pass payment_status explicitly to model an async/unpaid one.
    data: {
      object:
        (type === "checkout.session.completed" ||
          type === "checkout.session.async_payment_succeeded") &&
        dataObject.payment_status === undefined
          ? { payment_status: "paid", ...dataObject }
          : dataObject,
    },
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

    // Every paid card also gets an (empty) message page + a link with a slug.
    const messagePageLink = await prisma.messagePageLink.findUnique({
      where: { orderRecipientId: orderRecipients[0]!.id },
      include: { messagePage: { select: { message: true } } },
    });
    expect(messagePageLink).not.toBeNull();
    expect(messagePageLink!.slug.length).toBeGreaterThanOrEqual(6);
    expect(messagePageLink!.messagePage.message).toBeNull();
  });

  it("does NOT fulfil a completed-but-unpaid session (delayed payment method still pending)", async () => {
    const { token } = await signUp();
    const { batchOrderId } = await createPendingPaymentBatchOrder(token);

    // A delayed-notification method completes the session before the money
    // clears: payment_status "unpaid". We must not fulfil yet.
    const payload = buildStripeEventPayload("checkout.session.completed", {
      id: `cs_test_${randomUUID()}`,
      payment_status: "unpaid",
      metadata: { batchOrderId },
    });
    await postWebhook(payload).expect(201);

    const order = await prisma.batchOrder.findUniqueOrThrow({ where: { id: batchOrderId } });
    expect(order.status).toBe("pending_payment");
    const orderRecipients = await prisma.orderRecipient.findMany({ where: { batchOrderId } });
    expect(orderRecipients[0]?.status).toBe("approved");
    const jobs = await prisma.fulfillmentJob.findMany({
      where: { orderRecipient: { batchOrderId } },
    });
    expect(jobs).toHaveLength(0);
  });

  it("fulfils on async_payment_succeeded once a delayed payment clears", async () => {
    const { token } = await signUp();
    const { batchOrderId } = await createPendingPaymentBatchOrder(token);

    // First the (unpaid) completed event — a no-op.
    await postWebhook(
      buildStripeEventPayload("checkout.session.completed", {
        id: `cs_test_${randomUUID()}`,
        payment_status: "unpaid",
        metadata: { batchOrderId },
      }),
    ).expect(201);
    expect(
      (await prisma.batchOrder.findUniqueOrThrow({ where: { id: batchOrderId } })).status,
    ).toBe("pending_payment");

    // Then it clears: async_payment_succeeded (paid) fulfils the order.
    await postWebhook(
      buildStripeEventPayload("checkout.session.async_payment_succeeded", {
        id: `cs_test_${randomUUID()}`,
        metadata: { batchOrderId },
      }),
    ).expect(201);

    const order = await prisma.batchOrder.findUniqueOrThrow({ where: { id: batchOrderId } });
    expect(order.status).toBe("paid");
    const orderRecipients = await prisma.orderRecipient.findMany({ where: { batchOrderId } });
    expect(orderRecipients[0]?.status).toBe("queued");
    const jobs = await prisma.fulfillmentJob.findMany({
      where: { orderRecipient: { batchOrderId } },
    });
    expect(jobs).toHaveLength(1);
  });

  it("releases the order back to draft on async_payment_failed", async () => {
    const { token } = await signUp();
    const { batchOrderId } = await createPendingPaymentBatchOrder(token);

    await postWebhook(
      buildStripeEventPayload("checkout.session.async_payment_failed", {
        id: `cs_test_${randomUUID()}`,
        metadata: { batchOrderId },
      }),
    ).expect(201);

    const order = await prisma.batchOrder.findUniqueOrThrow({ where: { id: batchOrderId } });
    expect(order.status).toBe("draft");
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
    // The claim link (carrying the token) is in the email body, rendered
    // through the shared branded shell (brand footer + accent).
    expect(receipt[0]?.[0]?.html).toContain(claimToken);
    expect(receipt[0]?.[0]?.html).toContain("Kudos Cards");
    expect(receipt[0]?.[0]?.html).toContain("#e5372a");

    // A redelivered event must NOT send a second receipt.
    sendTransactional.mockClear();
    await postWebhook(payload).expect(201);
    const resent = (sendTransactional.mock.calls as Array<[{ to: string }]>).filter(
      (call) => call[0]?.to === "guest-buyer@example.com",
    );
    expect(resent).toHaveLength(0);
  });

  it("emails an account holder an order confirmation on payment, exactly once", async () => {
    const { token, accountId } = await signUp();
    const { batchOrderId } = await createPendingPaymentBatchOrder(token);
    // An account holder (NOT a guest): a contact email but no claim token.
    await prisma.account.update({
      where: { id: accountId },
      data: { contactEmail: "account-holder@example.com", claimToken: null },
    });
    const order = await prisma.batchOrder.findUniqueOrThrow({ where: { id: batchOrderId } });
    sendTransactional.mockClear();

    const payload = buildStripeEventPayload("checkout.session.completed", {
      id: `cs_test_${randomUUID()}`,
      metadata: { batchOrderId },
    });
    await postWebhook(payload).expect(201);

    const calls = sendTransactional.mock.calls as Array<[{ to: string; html: string }]>;
    const confirmation = calls.filter((call) => call[0]?.to === "account-holder@example.com");
    expect(confirmation).toHaveLength(1);
    const html = confirmation[0]?.[0]?.html ?? "";
    // The order confirmation carries the order ref, a view link, and the brand
    // shell — and is NOT the guest claim email.
    expect(html).toContain(`ORD-${order.orderNumber}`);
    expect(html).toContain(`/orders/${batchOrderId}`);
    expect(html).toContain("Kudos Cards");
    expect(html).not.toContain("Create your free account");
    expect(html).not.toContain("/gift/claim");

    // A redelivered event must NOT send a second confirmation.
    sendTransactional.mockClear();
    await postWebhook(payload).expect(201);
    const resent = (sendTransactional.mock.calls as Array<[{ to: string }]>).filter(
      (call) => call[0]?.to === "account-holder@example.com",
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

  it("does not resurrect a cancelled subscription when a stale 'active' event arrives after the cancellation", async () => {
    const { accountId } = await signUp();
    const stripeSubscriptionId = `sub_test_${randomUUID()}`;
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    const baseCreated = Math.floor(Date.now() / 1000);

    // 1. The subscription goes active (event created at T).
    await postWebhook(
      buildStripeEventPayload(
        "customer.subscription.created",
        {
          id: stripeSubscriptionId,
          status: "active",
          metadata: { accountId, planId: "pro" },
          items: { data: [{ current_period_end: periodEnd }] },
        },
        baseCreated,
      ),
    ).expect(201);

    // 2. It's cancelled a minute later (event created at T+60) → account on free.
    await postWebhook(
      buildStripeEventPayload(
        "customer.subscription.deleted",
        {
          id: stripeSubscriptionId,
          status: "canceled",
          metadata: { accountId, planId: "pro" },
          items: { data: [{ current_period_end: periodEnd }] },
        },
        baseCreated + 60,
      ),
    ).expect(201);

    // 3. Stripe redelivers the original 'active' update out of order (created at
    //    T+30, i.e. before the cancellation). It must be dropped — the row stays
    //    cancelled and the account stays on free.
    await postWebhook(
      buildStripeEventPayload(
        "customer.subscription.updated",
        {
          id: stripeSubscriptionId,
          status: "active",
          metadata: { accountId, planId: "pro" },
          items: { data: [{ current_period_end: periodEnd }] },
        },
        baseCreated + 30,
      ),
    ).expect(201);

    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { stripeSubscriptionId },
    });
    expect(subscription.status).toBe("canceled");

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.planId).toBe("free");
  });

  it("ignores a subscription update that predates the last applied event", async () => {
    const { accountId } = await signUp();
    const stripeSubscriptionId = `sub_test_${randomUUID()}`;
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    const baseCreated = Math.floor(Date.now() / 1000);

    // Newest state first: past_due at T+100.
    await postWebhook(
      buildStripeEventPayload(
        "customer.subscription.updated",
        {
          id: stripeSubscriptionId,
          status: "past_due",
          metadata: { accountId, planId: "pro" },
          items: { data: [{ current_period_end: periodEnd }] },
        },
        baseCreated + 100,
      ),
    ).expect(201);

    // A stale 'active' redelivery from T (long before) must not overwrite it.
    await postWebhook(
      buildStripeEventPayload(
        "customer.subscription.updated",
        {
          id: stripeSubscriptionId,
          status: "active",
          metadata: { accountId, planId: "pro" },
          items: { data: [{ current_period_end: periodEnd }] },
        },
        baseCreated,
      ),
    ).expect(201);

    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { stripeSubscriptionId },
    });
    expect(subscription.status).toBe("past_due");
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

  it("attaches the Stripe VAT invoice (PDF + hosted URL) to the order on invoice.paid", async () => {
    const { token } = await signUp();
    const { batchOrderId } = await createPendingPaymentBatchOrder(token);
    const invoiceId = `in_test_${randomUUID()}`;

    const payload = buildStripeEventPayload("invoice.paid", {
      id: invoiceId,
      hosted_invoice_url: "https://invoice.stripe.com/i/test_hosted",
      invoice_pdf: "https://invoice.stripe.com/i/test_hosted/pdf",
      metadata: { batchOrderId },
    });
    await postWebhook(payload).expect(201);

    const order = await prisma.batchOrder.findUniqueOrThrow({ where: { id: batchOrderId } });
    expect(order.stripeInvoiceId).toBe(invoiceId);
    expect(order.receiptPdfUrl).toBe("https://invoice.stripe.com/i/test_hosted/pdf");
    expect(order.receiptUrl).toBe("https://invoice.stripe.com/i/test_hosted");
  });

  it("ignores an invoice.paid that is neither a card order nor a subscription", async () => {
    // No batchOrderId and no subscription behind it — a one-off Stripe invoice
    // raised by hand. It must not land in subscription income.
    const invoiceId = `in_test_${randomUUID()}`;
    const payload = buildStripeEventPayload("invoice.paid", {
      id: invoiceId,
      hosted_invoice_url: "https://invoice.stripe.com/i/sub",
      invoice_pdf: "https://invoice.stripe.com/i/sub/pdf",
      metadata: {},
    });
    await postWebhook(payload).expect(201);

    expect(
      await prisma.subscriptionInvoice.findUnique({ where: { stripeInvoiceId: invoiceId } }),
    ).toBeNull();
  });

  describe("subscription invoices", () => {
    /** An account with a Stripe customer id, the durable link an invoice carries. */
    async function accountWithStripeCustomer(): Promise<{
      accountId: string;
      stripeCustomerId: string;
    }> {
      const { accountId } = await signUp();
      const stripeCustomerId = `cus_test_${randomUUID()}`;
      await prisma.account.update({ where: { id: accountId }, data: { stripeCustomerId } });
      return { accountId, stripeCustomerId };
    }

    /** A paid subscription invoice as Stripe sends it in this API version:
     *  the subscription hangs off `parent`, not a top-level `subscription`. */
    function subscriptionInvoice(overrides: {
      id: string;
      customer: string;
      subscription: string;
      amountPaid?: number;
      paidAt?: number;
    }) {
      const paidAt = overrides.paidAt ?? Math.floor(Date.parse("2026-07-01T09:00:00Z") / 1000);
      return buildStripeEventPayload("invoice.paid", {
        id: overrides.id,
        customer: overrides.customer,
        amount_paid: overrides.amountPaid ?? 997,
        currency: "gbp",
        status: "paid",
        billing_reason: "subscription_cycle",
        created: paidAt,
        period_start: paidAt,
        period_end: paidAt + 30 * 24 * 60 * 60,
        status_transitions: { paid_at: paidAt },
        hosted_invoice_url: "https://invoice.stripe.com/i/sub_hosted",
        invoice_pdf: "https://invoice.stripe.com/i/sub_hosted/pdf",
        parent: {
          type: "subscription_details",
          subscription_details: { subscription: overrides.subscription },
        },
        metadata: {},
      });
    }

    it("records a paid subscription invoice against the account", async () => {
      const { accountId, stripeCustomerId } = await accountWithStripeCustomer();
      const invoiceId = `in_test_${randomUUID()}`;
      const subscriptionId = `sub_test_${randomUUID()}`;

      await postWebhook(
        subscriptionInvoice({
          id: invoiceId,
          customer: stripeCustomerId,
          subscription: subscriptionId,
          amountPaid: 1997,
        }),
      ).expect(201);

      const row = await prisma.subscriptionInvoice.findUniqueOrThrow({
        where: { stripeInvoiceId: invoiceId },
      });
      expect(row.accountId).toBe(accountId);
      expect(row.amountPaidMinor).toBe(1997);
      expect(row.currency).toBe("gbp");
      expect(row.stripeSubscriptionId).toBe(subscriptionId);
      expect(row.billingReason).toBe("subscription_cycle");
      // Stripe's own paid date, not the day we recorded it.
      expect(row.paidAt.toISOString()).toBe("2026-07-01T09:00:00.000Z");
      expect(row.invoicePdfUrl).toBe("https://invoice.stripe.com/i/sub_hosted/pdf");
    });

    it("is idempotent — a redelivered invoice doesn't double-count", async () => {
      // Stripe delivers at-least-once, and the backfill reads the same key, so
      // this is what stops the two paths inflating revenue.
      const { accountId, stripeCustomerId } = await accountWithStripeCustomer();
      const invoiceId = `in_test_${randomUUID()}`;
      const payload = subscriptionInvoice({
        id: invoiceId,
        customer: stripeCustomerId,
        subscription: `sub_test_${randomUUID()}`,
      });

      await postWebhook(payload).expect(201);
      await postWebhook(payload).expect(201);

      const rows = await prisma.subscriptionInvoice.findMany({ where: { accountId } });
      expect(rows).toHaveLength(1);
    });

    it("falls back to the tracked subscription when the customer id isn't on the account", async () => {
      const { accountId } = await signUp();
      const subscriptionId = `sub_test_${randomUUID()}`;
      await prisma.subscription.create({
        data: {
          accountId,
          planId: "pro",
          stripeSubscriptionId: subscriptionId,
          status: "active",
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
      const invoiceId = `in_test_${randomUUID()}`;

      await postWebhook(
        subscriptionInvoice({
          id: invoiceId,
          customer: `cus_unknown_${randomUUID()}`,
          subscription: subscriptionId,
        }),
      ).expect(201);

      const row = await prisma.subscriptionInvoice.findUniqueOrThrow({
        where: { stripeInvoiceId: invoiceId },
      });
      expect(row.accountId).toBe(accountId);
    });

    it("does not fail the webhook when the invoice can't be matched to an account", async () => {
      // Stripe must not retry a payment we've already handled just because our
      // bookkeeping couldn't place it.
      const invoiceId = `in_test_${randomUUID()}`;

      await postWebhook(
        subscriptionInvoice({
          id: invoiceId,
          customer: `cus_unknown_${randomUUID()}`,
          subscription: `sub_unknown_${randomUUID()}`,
        }),
      ).expect(201);

      expect(
        await prisma.subscriptionInvoice.findUnique({ where: { stripeInvoiceId: invoiceId } }),
      ).toBeNull();
    });

    it("keeps a card-order invoice out of subscription income", async () => {
      const { token } = await signUp();
      const { batchOrderId } = await createPendingPaymentBatchOrder(token);
      const invoiceId = `in_test_${randomUUID()}`;

      await postWebhook(
        buildStripeEventPayload("invoice.paid", {
          id: invoiceId,
          hosted_invoice_url: "https://invoice.stripe.com/i/card",
          invoice_pdf: "https://invoice.stripe.com/i/card/pdf",
          metadata: { batchOrderId },
        }),
      ).expect(201);

      expect(
        await prisma.subscriptionInvoice.findUnique({ where: { stripeInvoiceId: invoiceId } }),
      ).toBeNull();
    });
  });
});
