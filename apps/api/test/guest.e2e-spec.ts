import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { guestCheckoutResultSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import type Stripe from "stripe";
import { PrismaService } from "../src/prisma/prisma.service";
import { STRIPE_CLIENT } from "../src/billing/stripe-client.provider";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

describe("Guest checkout (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let checkoutSessionsCreate: jest.Mock;
  let cardDesignId: string;

  beforeAll(async () => {
    checkoutSessionsCreate = jest.fn();
    const mockStripe = {
      checkout: { sessions: { create: checkoutSessionsCreate } },
    } as unknown as Stripe;
    app = await createTestApp([{ provide: STRIPE_CLIENT, useValue: mockStripe }]);
    prisma = app.get(PrismaService);
    const design = await prisma.cardDesign.findFirstOrThrow({ where: { isActive: true } });
    cardDesignId = design.id;
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
        payment_intent: `pi_test_${id}`,
      });
    });
  });

  function guestBody(overrides: Record<string, unknown> = {}) {
    return {
      cardDesignId,
      buyerEmail: `buyer-${randomUUID()}@example.com`,
      recipientFirstName: "Grandma",
      recipientLastName: "Jones",
      shippingAddressLine1: "1 Test Street",
      shippingAddressCity: "London",
      shippingAddressPostcode: "SW1A 1AA",
      ...overrides,
    };
  }

  it("lets an unauthenticated visitor buy a single card and returns a Stripe URL", async () => {
    const body = guestBody();
    const response = await request(app.getHttpServer())
      .post("/guest/checkout")
      .send(body)
      .expect(201);

    const result = guestCheckoutResultSchema.parse(response.body);
    expect(result.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.test\/pay\/cs_test_/);

    // A fresh guest account was minted: individual type, buyer email captured,
    // a claim token set, and — crucially — NO membership (nobody's logged in).
    const order = await prisma.batchOrder.findUniqueOrThrow({ where: { id: result.orderId } });
    expect(order.createdByUserId).toBeNull();
    expect(order.status).toBe("pending_payment");

    const account = await prisma.account.findUniqueOrThrow({ where: { id: order.accountId } });
    expect(account.type).toBe("individual");
    expect(account.contactEmail).toBe(body.buyerEmail);
    expect(account.claimToken).toBeTruthy();
    expect(account.claimTokenExpiresAt).toBeTruthy();

    const membershipCount = await prisma.membership.count({ where: { accountId: account.id } });
    expect(membershipCount).toBe(0);

    // Exactly one card, priced at the flat £1.50 (no plan discount for guests).
    const lines = await prisma.orderRecipient.findMany({ where: { batchOrderId: order.id } });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.priceMinor).toBe(150);

    // The buyer's email was handed to Stripe for prefill + receipt.
    const calls = checkoutSessionsCreate.mock.calls as Array<[{ customer_email?: string }]>;
    expect(calls[0]?.[0]?.customer_email).toBe(body.buyerEmail);
  });

  it("isolates each guest purchase in its own account", async () => {
    const first = guestCheckoutResultSchema.parse(
      (await request(app.getHttpServer()).post("/guest/checkout").send(guestBody()).expect(201))
        .body,
    );
    const second = guestCheckoutResultSchema.parse(
      (await request(app.getHttpServer()).post("/guest/checkout").send(guestBody()).expect(201))
        .body,
    );

    const orderA = await prisma.batchOrder.findUniqueOrThrow({ where: { id: first.orderId } });
    const orderB = await prisma.batchOrder.findUniqueOrThrow({ where: { id: second.orderId } });
    expect(orderA.accountId).not.toBe(orderB.accountId);
  });

  function cartItem(overrides: Record<string, unknown> = {}) {
    return {
      cardDesignId,
      recipientFirstName: "Grandma",
      recipientLastName: "Jones",
      shippingAddressLine1: "1 Test Street",
      shippingAddressCity: "London",
      shippingAddressPostcode: "SW1A 1AA",
      ...overrides,
    };
  }

  it("lets a visitor buy a basket of several cards in one order and one payment", async () => {
    const buyerEmail = `basket-${randomUUID()}@example.com`;
    const body = {
      buyerEmail,
      items: [
        cartItem({ recipientFirstName: "Ava", recipientLastName: "Patel" }),
        cartItem({ recipientFirstName: "Tom", recipientLastName: "Reed" }),
        cartItem({ recipientFirstName: "Mia", recipientLastName: "Cole" }),
      ],
    };
    const response = await request(app.getHttpServer())
      .post("/guest/cart-checkout")
      .send(body)
      .expect(201);

    const result = guestCheckoutResultSchema.parse(response.body);
    expect(result.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.test\/pay\/cs_test_/);

    // One order, one guest account, no membership — the whole basket.
    const order = await prisma.batchOrder.findUniqueOrThrow({ where: { id: result.orderId } });
    expect(order.status).toBe("pending_payment");
    const account = await prisma.account.findUniqueOrThrow({ where: { id: order.accountId } });
    expect(account.contactEmail).toBe(buyerEmail);
    expect(await prisma.membership.count({ where: { accountId: account.id } })).toBe(0);

    // Three distinct recipients, each a flat £1.50 card → £4.50 order.
    const lines = await prisma.orderRecipient.findMany({ where: { batchOrderId: order.id } });
    expect(lines).toHaveLength(3);
    expect(lines.every((line) => line.priceMinor === 150)).toBe(true);
    const recipients = await prisma.recipient.findMany({ where: { accountId: account.id } });
    expect(recipients.map((r) => r.firstName).sort()).toEqual(["Ava", "Mia", "Tom"]);

    // One Checkout Session for the whole basket, buyer email prefilled.
    const calls = checkoutSessionsCreate.mock.calls as Array<[{ customer_email?: string }]>;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]?.customer_email).toBe(buyerEmail);
  });

  it("mints no guest account when any card in the basket is invalid", async () => {
    const buyerEmail = `bad-basket-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/guest/cart-checkout")
      .send({
        buyerEmail,
        items: [cartItem(), cartItem({ cardDesignId: randomUUID() })],
      })
      .expect(404);
    // The whole basket is validated before anything is minted — no orphan account.
    expect(await prisma.account.count({ where: { contactEmail: buyerEmail } })).toBe(0);
  });

  it("rejects an empty basket", async () => {
    await request(app.getHttpServer())
      .post("/guest/cart-checkout")
      .send({ buyerEmail: `empty-${randomUUID()}@example.com`, items: [] })
      .expect(400);
  });

  it("rejects a basket larger than the per-order cap", async () => {
    await request(app.getHttpServer())
      .post("/guest/cart-checkout")
      .send({
        buyerEmail: `big-${randomUUID()}@example.com`,
        items: Array.from({ length: 21 }, () => cartItem()),
      })
      .expect(400);
  });

  it("rejects a non-existent card design", async () => {
    await request(app.getHttpServer())
      .post("/guest/checkout")
      .send(guestBody({ cardDesignId: randomUUID() }))
      .expect(404);
  });

  it("rejects a malformed email", async () => {
    await request(app.getHttpServer())
      .post("/guest/checkout")
      .send(guestBody({ buyerEmail: "not-an-email" }))
      .expect(400);
  });

  /** A guest checkout; returns the created account's id + secret claim token. */
  async function guestCheckout(
    email: string,
  ): Promise<{ accountId: string; claimToken: string }> {
    const response = await request(app.getHttpServer())
      .post("/guest/checkout")
      .send(guestBody({ buyerEmail: email }))
      .expect(201);
    const { orderId } = guestCheckoutResultSchema.parse(response.body);
    const order = await prisma.batchOrder.findUniqueOrThrow({ where: { id: orderId } });
    const account = await prisma.account.findUniqueOrThrow({ where: { id: order.accountId } });
    return { accountId: account.id, claimToken: account.claimToken! };
  }

  it("claims a guest account by attaching a matching-email login", async () => {
    const email = `claimer-${randomUUID()}@example.com`;
    const { accountId, claimToken } = await guestCheckout(email);

    // Public prefill returns the buyer's email.
    const info = await request(app.getHttpServer())
      .get(`/guest/claim/${claimToken}`)
      .expect(200);
    expect((info.body as { email: string }).email).toBe(email);

    // The buyer signs up (same email) and claims.
    const userId = randomUUID();
    const token = await mintToken(userId, email);
    await request(app.getHttpServer())
      .post("/guest/claim")
      .set("Authorization", `Bearer ${token}`)
      .send({ claimToken })
      .expect(201);

    // Membership attached, token spent, and /accounts/me now resolves for them.
    const membership = await prisma.membership.findFirstOrThrow({ where: { userId } });
    expect(membership.accountId).toBe(accountId);
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.claimToken).toBeNull();
    await request(app.getHttpServer())
      .get("/accounts/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    // The token is single-use — a second claim finds nothing.
    const someoneElse = await mintToken(randomUUID(), email);
    await request(app.getHttpServer())
      .post("/guest/claim")
      .set("Authorization", `Bearer ${someoneElse}`)
      .send({ claimToken })
      .expect(404);
  });

  it("refuses to claim with a different email than the order was bought with", async () => {
    const { claimToken } = await guestCheckout(`buyer-${randomUUID()}@example.com`);
    const token = await mintToken(randomUUID(), `someone-else-${randomUUID()}@example.com`);
    await request(app.getHttpServer())
      .post("/guest/claim")
      .set("Authorization", `Bearer ${token}`)
      .send({ claimToken })
      .expect(403);
  });

  it("refuses to claim when the user already has an account", async () => {
    const email = `existing-${randomUUID()}@example.com`;
    const token = await mintToken(randomUUID(), email);
    // This user already owns an account.
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "individual", name: "Already Here" })
      .expect(201);

    const { claimToken } = await guestCheckout(email);
    await request(app.getHttpServer())
      .post("/guest/claim")
      .set("Authorization", `Bearer ${token}`)
      .send({ claimToken })
      .expect(409);
  });

  it("returns 404 prefill for an unknown claim token", async () => {
    await request(app.getHttpServer()).get(`/guest/claim/${randomUUID()}`).expect(404);
  });
});
