import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { accountSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import Stripe from "stripe";
import { PrismaService } from "../src/prisma/prisma.service";
import { STRIPE_CLIENT } from "../src/billing/stripe-client.provider";
import type { AutoSendResult } from "../src/auto-send/auto-send.service";
import type { EnvConfig } from "../src/config/env.schema";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/** Today as a plain YYYY-MM-DD, so an occasion dated today has a dispatch date
 * in the past and is therefore due for the auto-send run. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

describe("Auto-send (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const cryptoStripe = new Stripe("sk_test_autosend_crypto_only");
  let webhookSecret: string;

  beforeAll(async () => {
    const mockStripe = {
      checkout: { sessions: { create: jest.fn() } },
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

  async function signUp(): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID());
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Centre ${randomUUID()}` })
      .expect(201);
    return { token, accountId: accountSchema.parse(response.body).id };
  }

  /** Puts the account on a plan whose entitlement enables auto-send. */
  async function enableAutoSend(accountId: string): Promise<void> {
    await prisma.account.update({ where: { id: accountId }, data: { planId: "pro" } });
  }

  async function opsToken(): Promise<string> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId } });
    return mintToken(userId);
  }

  async function creditWallet(accountId: string, amountMinor: number): Promise<void> {
    const sessionId = `cs_test_${randomUUID()}`;
    const payload = JSON.stringify({
      id: `evt_${randomUUID()}`,
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: sessionId,
          metadata: { type: "wallet_topup", accountId, amountMinor: String(amountMinor) },
        },
      },
    });
    const signature = cryptoStripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    });
    await request(app.getHttpServer())
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(payload)
      .expect(201);
  }

  async function createRecipient(token: string, withAddress: boolean): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Sam",
        lastName: "Recipient",
        ...(withAddress && {
          addressLine1: "1 Test Street",
          addressCity: "London",
          addressPostcode: "SW1A 1AA",
        }),
      })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  async function createSavedDesign(token: string): Promise<string> {
    const templates = await request(app.getHttpServer())
      .get("/card-designs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const cardDesignId = (templates.body as { id: string }[])[0]!.id;
    const response = await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({ cardDesignId, name: "Auto design" })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  /** A pending_approval occasion dated today (so it's due once auto-send-approved). */
  async function createOccasion(token: string, recipientId: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "achievement", occasionDate: todayIso(), recipientId })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  function approve(token: string, occasionId: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/occasions/${occasionId}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  }

  function runAutoSend(opsBearer: string) {
    return request(app.getHttpServer())
      .post("/auto-send/run")
      .set("Authorization", `Bearer ${opsBearer}`);
  }

  async function walletBalance(token: string): Promise<number> {
    const response = await request(app.getHttpServer())
      .get("/wallet")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    return (response.body as { balanceMinor: number }).balanceMinor;
  }

  it("rejects an auto-send approval on a plan without the entitlement", async () => {
    const { token } = await signUp(); // defaults to the free plan
    const recipientId = await createRecipient(token, true);
    const savedDesignId = await createSavedDesign(token);
    const occasionId = await createOccasion(token, recipientId);

    await approve(token, occasionId, { savedDesignId, dispatchOption: "auto_send" }).expect(403);
  });

  it("rejects an auto-send approval when the recipient has no postal address", async () => {
    const { token, accountId } = await signUp();
    await enableAutoSend(accountId);
    const recipientId = await createRecipient(token, false);
    const savedDesignId = await createSavedDesign(token);
    const occasionId = await createOccasion(token, recipientId);

    await approve(token, occasionId, { savedDesignId, dispatchOption: "auto_send" }).expect(400);
  });

  it("orders, pays from the wallet, and fulfils a due auto-send occasion", async () => {
    const { token, accountId } = await signUp();
    await enableAutoSend(accountId);
    await creditWallet(accountId, 1000);
    const recipientId = await createRecipient(token, true);
    const savedDesignId = await createSavedDesign(token);
    const occasionId = await createOccasion(token, recipientId);
    await approve(token, occasionId, {
      savedDesignId,
      dispatchOption: "auto_send",
      postageClass: "first_class",
    }).expect(201);

    const ops = await opsToken();
    const runResponse = await runAutoSend(ops).expect(201);
    const result = runResponse.body as AutoSendResult;
    // The run is global (every account); assert on this occasion, not a total.
    expect(result.sent).toBeGreaterThanOrEqual(1);
    expect(result.skipped).not.toContainEqual(expect.objectContaining({ occasionId }));

    // Occasion consumed.
    const occasion = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
    expect(occasion.status).toBe("queued");

    // An order was created, paid from the wallet, and priced pro (£2.25) + first
    // class stamp (£1.80) = £3.15.
    const order = await prisma.batchOrder.findFirstOrThrow({
      where: { accountId },
      include: { orderRecipients: true },
    });
    expect(order.status).toBe("paid");
    expect(order.paymentMethod).toBe("wallet");
    expect(order.totalMinor).toBe(225 + 180);
    expect(order.orderRecipients[0]?.status).toBe("queued");
    expect(order.orderRecipients[0]?.shippingAddressPostcode).toBe("SW1A 1AA");

    // Fulfilment job + message page minted.
    const job = await prisma.fulfillmentJob.findFirst({
      where: { orderRecipientId: order.orderRecipients[0]!.id },
    });
    expect(job?.status).toBe("pending");
    const messagePage = await prisma.messagePage.findUnique({
      where: { orderRecipientId: order.orderRecipients[0]!.id },
    });
    expect(messagePage).not.toBeNull();

    // Wallet debited by exactly the order total.
    expect(await walletBalance(token)).toBe(1000 - (225 + 180));
  });

  it("skips (and leaves approved) an occasion the wallet can't cover", async () => {
    const { token, accountId } = await signUp();
    await enableAutoSend(accountId);
    await creditWallet(accountId, 100); // far short of the ~£3 total
    const recipientId = await createRecipient(token, true);
    const savedDesignId = await createSavedDesign(token);
    const occasionId = await createOccasion(token, recipientId);
    await approve(token, occasionId, { savedDesignId, dispatchOption: "auto_send" }).expect(201);

    const ops = await opsToken();
    const runResponse = await runAutoSend(ops).expect(201);
    const result = runResponse.body as AutoSendResult;
    expect(result.skipped).toContainEqual({
      occasionId,
      reason: "Insufficient wallet balance",
    });

    // Untouched: occasion still approved, no order, balance intact.
    const occasion = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
    expect(occasion.status).toBe("approved");
    const orders = await prisma.batchOrder.findMany({ where: { accountId } });
    expect(orders).toHaveLength(0);
    expect(await walletBalance(token)).toBe(100);

    // This occasion stays due-and-unfundable forever; remove it so it can't
    // pollute the global runs in later tests.
    await prisma.occasion.delete({ where: { id: occasionId } });
  });

  it("is idempotent — a second run does not re-send an already-sent occasion", async () => {
    const { token, accountId } = await signUp();
    await enableAutoSend(accountId);
    await creditWallet(accountId, 1000);
    const recipientId = await createRecipient(token, true);
    const savedDesignId = await createSavedDesign(token);
    const occasionId = await createOccasion(token, recipientId);
    await approve(token, occasionId, { savedDesignId, dispatchOption: "auto_send" }).expect(201);

    const ops = await opsToken();
    await runAutoSend(ops).expect(201);
    const secondRun = await runAutoSend(ops).expect(201);
    // The occasion is now queued, so it's no longer picked up as due — the
    // second run neither re-sends nor skips it.
    expect((secondRun.body as AutoSendResult).skipped).not.toContainEqual(
      expect.objectContaining({ occasionId }),
    );

    // The real idempotency guarantee: exactly one order for this account.
    const orders = await prisma.batchOrder.findMany({ where: { accountId } });
    expect(orders).toHaveLength(1);
  });

  it("never auto-sends an asap occasion", async () => {
    const { token, accountId } = await signUp();
    await enableAutoSend(accountId);
    await creditWallet(accountId, 1000);
    const recipientId = await createRecipient(token, true);
    const savedDesignId = await createSavedDesign(token);
    const occasionId = await createOccasion(token, recipientId);
    await approve(token, occasionId, { savedDesignId }).expect(201); // asap (default)

    const ops = await opsToken();
    await runAutoSend(ops).expect(201);

    // The asap occasion is never picked up: still approved, no order.
    const occasion = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
    expect(occasion.status).toBe("approved");
    const orders = await prisma.batchOrder.findMany({ where: { accountId } });
    expect(orders).toHaveLength(0);
  });

  it("forbids a non-admin from triggering an auto-send run", async () => {
    const { token } = await signUp();
    await runAutoSend(token).expect(403);
  });
});
