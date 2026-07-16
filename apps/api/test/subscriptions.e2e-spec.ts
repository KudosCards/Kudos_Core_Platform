import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import type Stripe from "stripe";
import { PrismaService } from "../src/prisma/prisma.service";
import { STRIPE_CLIENT } from "../src/billing/stripe-client.provider";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

describe("Subscriptions (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let checkoutSessionsCreate: jest.Mock;
  let customersCreate: jest.Mock;

  beforeAll(async () => {
    checkoutSessionsCreate = jest.fn();
    customersCreate = jest.fn();
    const mockStripe = {
      checkout: { sessions: { create: checkoutSessionsCreate } },
      customers: { create: customersCreate },
    } as unknown as Stripe;

    app = await createTestApp([{ provide: STRIPE_CLIENT, useValue: mockStripe }]);
    prisma = app.get(PrismaService);
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
    customersCreate.mockReset();
    customersCreate.mockImplementation(() => Promise.resolve({ id: `cus_test_${randomUUID()}` }));
  });

  async function signUp(): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID());
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Test Centre ${randomUUID()}` })
      .expect(201);
    return { token, accountId: accountSchema.parse(response.body).id };
  }

  it("rejects checkout for the free plan", async () => {
    const { token } = await signUp();
    await request(app.getHttpServer())
      .post("/subscriptions/checkout")
      .set("Authorization", `Bearer ${token}`)
      .send({ planId: "free" })
      .expect(400);
  });

  it("rejects checkout for a plan that has no Stripe price configured yet", async () => {
    // The real seeded state as of this phase — no Stripe Price IDs exist
    // until they're created in the Stripe Dashboard and given to us.
    const { token } = await signUp();
    await request(app.getHttpServer())
      .post("/subscriptions/checkout")
      .set("Authorization", `Bearer ${token}`)
      .send({ planId: "pro" })
      .expect(409);
    expect(checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("creates a Stripe customer once and reuses it across checkout calls", async () => {
    const { token, accountId } = await signUp();
    await prisma.planEntitlement.update({
      where: { planId: "pro" },
      data: { stripePriceId: "price_test_pro" },
    });

    try {
      const first = await request(app.getHttpServer())
        .post("/subscriptions/checkout")
        .set("Authorization", `Bearer ${token}`)
        .send({ planId: "pro" })
        .expect(201);
      expect(first.body).toEqual({ checkoutUrl: expect.stringMatching(/^https:\/\//) });
      expect(customersCreate).toHaveBeenCalledTimes(1);

      const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
      expect(account.stripeCustomerId).toMatch(/^cus_test_/);

      await request(app.getHttpServer())
        .post("/subscriptions/checkout")
        .set("Authorization", `Bearer ${token}`)
        .send({ planId: "pro" })
        .expect(201);
      // Second checkout reuses the same Customer — Stripe.customers.create is
      // not called again.
      expect(customersCreate).toHaveBeenCalledTimes(1);

      const [sessionArgs] = checkoutSessionsCreate.mock.calls[1] as [
        Stripe.Checkout.SessionCreateParams,
      ];
      expect(sessionArgs.mode).toBe("subscription");
      expect(sessionArgs.customer).toBe(account.stripeCustomerId);
      expect(sessionArgs.line_items?.[0]?.price).toBe("price_test_pro");
      expect(sessionArgs.subscription_data?.metadata).toEqual({ accountId, planId: "pro" });
    } finally {
      await prisma.planEntitlement.update({
        where: { planId: "pro" },
        data: { stripePriceId: null },
      });
    }
  });

  it("rejects starting a second subscription while one is already active", async () => {
    const { token, accountId } = await signUp();
    await prisma.planEntitlement.update({
      where: { planId: "pro" },
      data: { stripePriceId: "price_test_pro" },
    });
    await prisma.planEntitlement.update({
      where: { planId: "centre" },
      data: { stripePriceId: "price_test_centre" },
    });

    try {
      await request(app.getHttpServer())
        .post("/subscriptions/checkout")
        .set("Authorization", `Bearer ${token}`)
        .send({ planId: "pro" })
        .expect(201);
      // Simulate the customer.subscription.created webhook having landed.
      await prisma.subscription.create({
        data: {
          accountId,
          planId: "pro",
          stripeSubscriptionId: `sub_test_${randomUUID()}`,
          status: "active",
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      checkoutSessionsCreate.mockClear();
      await request(app.getHttpServer())
        .post("/subscriptions/checkout")
        .set("Authorization", `Bearer ${token}`)
        .send({ planId: "centre" })
        .expect(409);
      expect(checkoutSessionsCreate).not.toHaveBeenCalled();
    } finally {
      await prisma.planEntitlement.update({
        where: { planId: "pro" },
        data: { stripePriceId: null },
      });
      await prisma.planEntitlement.update({
        where: { planId: "centre" },
        data: { stripePriceId: null },
      });
    }
  });
});
