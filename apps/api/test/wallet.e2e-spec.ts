import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { accountSchema, walletSummarySchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import Stripe from "stripe";
import { PrismaService } from "../src/prisma/prisma.service";
import { STRIPE_CLIENT } from "../src/billing/stripe-client.provider";
import type { EnvConfig } from "../src/config/env.schema";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/** The JSON wire envelope every Stripe event shares — see webhooks.e2e-spec.ts. */
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

describe("Wallet (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let checkoutSessionsCreate: jest.Mock;
  let webhookSecret: string;
  // Real SDK instance purely for its local webhook crypto (constructEvent /
  // generateTestHeaderString are pure crypto, no network); the placeholder key
  // is never used to reach Stripe.
  const cryptoStripe = new Stripe("sk_test_wallet_crypto_only");

  beforeAll(async () => {
    checkoutSessionsCreate = jest.fn();
    const mockStripe = {
      checkout: { sessions: { create: checkoutSessionsCreate } },
      // Real crypto so signed webhooks verify against the app's secret.
      webhooks: cryptoStripe.webhooks,
    } as unknown as Stripe;

    app = await createTestApp([{ provide: STRIPE_CLIENT, useValue: mockStripe }]);
    prisma = app.get(PrismaService);
    const config = app.get(ConfigService<EnvConfig, true>);
    webhookSecret = config.get("STRIPE_WEBHOOK_SECRET", { infer: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    checkoutSessionsCreate.mockReset();
    checkoutSessionsCreate.mockImplementation(() => {
      const id = randomUUID();
      return Promise.resolve({
        id: `cs_test_${id}`,
        url: `https://checkout.stripe.test/pay/cs_test_${id}`,
      });
    });
  });

  function postWebhook(payload: string, secret: string = webhookSecret) {
    const signature = cryptoStripe.webhooks.generateTestHeaderString({ payload, secret });
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

  /** Credits a wallet the way production does: a signed wallet_topup webhook. */
  async function topUpViaWebhook(accountId: string, amountMinor: number): Promise<string> {
    const sessionId = `cs_test_${randomUUID()}`;
    const payload = buildStripeEventPayload("checkout.session.completed", {
      id: sessionId,
      metadata: { type: "wallet_topup", accountId, amountMinor: String(amountMinor) },
    });
    await postWebhook(payload).expect(201);
    return sessionId;
  }

  async function getWallet(token: string) {
    const response = await request(app.getHttpServer())
      .get("/wallet")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    return walletSummarySchema.parse(response.body);
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

  /** A draft batch order (one first-class card = £3.30) ready to be paid. */
  async function createDraftOrder(token: string): Promise<{ id: string; totalMinor: number }> {
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
    const order = orderResponse.body as { id: string; totalMinor: number };
    return { id: order.id, totalMinor: order.totalMinor };
  }

  it("starts with a zero balance and an empty ledger", async () => {
    const { token } = await signUp();
    const response = await request(app.getHttpServer())
      .get("/wallet")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(response.body).toEqual({ balanceMinor: 0, currency: "GBP", entries: [] });
  });

  it("creates a Stripe Checkout Session for a top-up, tagged wallet_topup", async () => {
    const { token, accountId } = await signUp();
    const response = await request(app.getHttpServer())
      .post("/wallet/top-up")
      .set("Authorization", `Bearer ${token}`)
      .send({ amountMinor: 2500 })
      .expect(201);
    expect(response.body).toEqual({
      checkoutUrl: expect.stringMatching(/^https:\/\/checkout\.stripe\.test\/pay\/cs_test_/),
    });

    const [sessionArgs] = checkoutSessionsCreate.mock.calls[0] as [Stripe.Checkout.SessionCreateParams];
    expect(sessionArgs.mode).toBe("payment");
    expect(sessionArgs.metadata).toMatchObject({
      type: "wallet_topup",
      accountId,
      amountMinor: "2500",
    });
    expect(sessionArgs.line_items?.[0]?.price_data?.unit_amount).toBe(2500);
  });

  it("rejects a top-up below the minimum", async () => {
    const { token } = await signUp();
    await request(app.getHttpServer())
      .post("/wallet/top-up")
      .set("Authorization", `Bearer ${token}`)
      .send({ amountMinor: 50 })
      .expect(400);
    expect(checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("credits the balance on a wallet_topup webhook and is idempotent on redelivery", async () => {
    const { token, accountId } = await signUp();
    const sessionId = `cs_test_${randomUUID()}`;
    const payload = buildStripeEventPayload("checkout.session.completed", {
      id: sessionId,
      metadata: { type: "wallet_topup", accountId, amountMinor: "2500" },
    });

    await postWebhook(payload).expect(201);
    await postWebhook(payload).expect(201); // at-least-once redelivery

    const summary = await getWallet(token);
    expect(summary.balanceMinor).toBe(2500);
    // Only one ledger entry despite two deliveries.
    expect(summary.entries).toHaveLength(1);
    expect(summary.entries[0]).toMatchObject({ type: "topup", amountMinor: 2500 });

    const ledger = await prisma.walletLedgerEntry.findMany({ where: { accountId } });
    expect(ledger).toHaveLength(1);
  });

  it("pays a draft order from the wallet: debits the balance, marks it paid, and fulfils it", async () => {
    const { token, accountId } = await signUp();
    await topUpViaWebhook(accountId, 1000);
    const order = await createDraftOrder(token);

    const response = await request(app.getHttpServer())
      .post(`/wallet/pay/${order.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    expect(response.body).toMatchObject({ status: "paid", paymentMethod: "wallet" });

    // Balance debited by the order total (£3.30).
    const summary = await getWallet(token);
    expect(summary.balanceMinor).toBe(1000 - order.totalMinor);

    // Recipients queued + a fulfillment job per card + a message page.
    const orderRecipients = await prisma.orderRecipient.findMany({
      where: { batchOrderId: order.id },
    });
    expect(orderRecipients).toHaveLength(1);
    expect(orderRecipients[0]?.status).toBe("queued");
    const jobs = await prisma.fulfillmentJob.findMany({
      where: { orderRecipientId: orderRecipients[0]!.id },
    });
    expect(jobs).toHaveLength(1);
    const messagePage = await prisma.messagePage.findUnique({
      where: { orderRecipientId: orderRecipients[0]!.id },
    });
    expect(messagePage).not.toBeNull();

    // A single charge entry recording the debit.
    const charges = await prisma.walletLedgerEntry.findMany({
      where: { accountId, type: "charge" },
    });
    expect(charges).toHaveLength(1);
    expect(charges[0]?.amountMinor).toBe(-order.totalMinor);
  });

  it("rejects wallet payment when the balance is insufficient", async () => {
    const { token, accountId } = await signUp();
    await topUpViaWebhook(accountId, 100); // far short of £3.30
    const order = await createDraftOrder(token);

    await request(app.getHttpServer())
      .post(`/wallet/pay/${order.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(403);

    // Nothing was charged and the order is untouched.
    const summary = await getWallet(token);
    expect(summary.balanceMinor).toBe(100);
    const persisted = await prisma.batchOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(persisted.status).toBe("draft");
    const charges = await prisma.walletLedgerEntry.findMany({
      where: { accountId, type: "charge" },
    });
    expect(charges).toHaveLength(0);
  });

  it("rejects a second wallet payment for an already-paid order", async () => {
    const { token, accountId } = await signUp();
    await topUpViaWebhook(accountId, 10_000);
    const order = await createDraftOrder(token);

    await request(app.getHttpServer())
      .post(`/wallet/pay/${order.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/wallet/pay/${order.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);

    // Charged exactly once.
    const charges = await prisma.walletLedgerEntry.findMany({
      where: { accountId, type: "charge" },
    });
    expect(charges).toHaveLength(1);
  });

  it("does not let one account pay another account's order from its wallet", async () => {
    const { token: ownerToken } = await signUp();
    const order = await createDraftOrder(ownerToken);

    const { token: otherToken, accountId: otherAccountId } = await signUp();
    await topUpViaWebhook(otherAccountId, 10_000);

    await request(app.getHttpServer())
      .post(`/wallet/pay/${order.id}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .expect(404);

    // The attacker's balance is untouched.
    const summary = await getWallet(otherToken);
    expect(summary.balanceMinor).toBe(10_000);
  });
});
