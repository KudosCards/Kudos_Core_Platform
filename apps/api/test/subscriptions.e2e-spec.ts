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

// The seat-billing endpoints need the per-seat Stripe Price id configured; set
// it before the app boots so ConfigService picks it up (it's optional in env).
const SEAT_PRICE_ID = "price_test_seat";
process.env.STRIPE_CENTRE_SEAT_PRICE_ID = SEAT_PRICE_ID;
// Centre plan price supplied purely via env (no DB stripePriceId) — proves the
// runtime env resolution that lets Railway activate a plan without a re-seed.
const CENTRE_ENV_PRICE_ID = "price_env_centre";
process.env.STRIPE_PRICE_ID_CENTRE = CENTRE_ENV_PRICE_ID;

describe("Subscriptions (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let checkoutSessionsCreate: jest.Mock;
  let customersCreate: jest.Mock;
  let subscriptionsRetrieve: jest.Mock;
  let subscriptionsUpdate: jest.Mock;

  beforeAll(async () => {
    checkoutSessionsCreate = jest.fn();
    customersCreate = jest.fn();
    subscriptionsRetrieve = jest.fn();
    subscriptionsUpdate = jest.fn();
    const mockStripe = {
      checkout: { sessions: { create: checkoutSessionsCreate } },
      customers: { create: customersCreate },
      subscriptions: { retrieve: subscriptionsRetrieve, update: subscriptionsUpdate },
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
    subscriptionsRetrieve.mockReset();
    subscriptionsUpdate.mockReset();
    subscriptionsUpdate.mockResolvedValue({});
  });

  /** A Centre account with an active subscription — the precondition for seat
   * changes. Returns the account id and the base subscription's Stripe id. */
  async function centreWithSubscription(
    token: string,
    accountId: string,
  ): Promise<{ stripeSubscriptionId: string }> {
    await prisma.account.update({ where: { id: accountId }, data: { planId: "centre" } });
    const stripeSubscriptionId = `sub_test_${randomUUID()}`;
    await prisma.subscription.create({
      data: {
        accountId,
        planId: "centre",
        stripeSubscriptionId,
        status: "active",
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    void token;
    return { stripeSubscriptionId };
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

  it("uses the STRIPE_PRICE_ID_<plan> env var when the plan has no seeded price id", async () => {
    // The seeded centre entitlement has a NULL stripePriceId here — only the env
    // var is set — so a successful checkout proves env resolution works alone.
    const centre = await prisma.planEntitlement.findUniqueOrThrow({ where: { planId: "centre" } });
    expect(centre.stripePriceId).toBeNull();

    const { token } = await signUp();
    const response = await request(app.getHttpServer())
      .post("/subscriptions/checkout")
      .set("Authorization", `Bearer ${token}`)
      .send({ planId: "centre" })
      .expect(201);
    expect(response.body).toEqual({ checkoutUrl: expect.stringMatching(/^https:\/\//) });

    const [sessionArgs] = checkoutSessionsCreate.mock.calls.at(-1) as [
      Stripe.Checkout.SessionCreateParams,
    ];
    expect(sessionArgs.line_items?.[0]?.price).toBe(CENTRE_ENV_PRICE_ID);
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

  describe("team seats", () => {
    it("adds an extra seat by adding the seat line item to the subscription", async () => {
      const { token, accountId } = await signUp();
      const { stripeSubscriptionId } = await centreWithSubscription(token, accountId);
      // The subscription has only the base plan item — no seat item yet.
      subscriptionsRetrieve.mockResolvedValue({
        items: { data: [{ id: "si_base", price: { id: "price_base" } }] },
      });

      const response = await request(app.getHttpServer())
        .post("/subscriptions/seats")
        .set("Authorization", `Bearer ${token}`)
        .send({ extraSeats: 2 })
        .expect(201);

      // Centre includes 3; +2 extra = a limit of 5.
      expect(response.body).toMatchObject({ includedSeats: 3, extraSeats: 2, limit: 5 });
      expect(subscriptionsUpdate).toHaveBeenCalledWith(
        stripeSubscriptionId,
        expect.objectContaining({ items: [{ price: SEAT_PRICE_ID, quantity: 2 }] }),
      );
      const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
      expect(account.extraSeats).toBe(2);
    });

    it("removes the seat item when the extra count drops to zero", async () => {
      const { token, accountId } = await signUp();
      await centreWithSubscription(token, accountId);
      await prisma.account.update({ where: { id: accountId }, data: { extraSeats: 2 } });
      // Now there IS a seat item on the subscription.
      subscriptionsRetrieve.mockResolvedValue({
        items: {
          data: [
            { id: "si_base", price: { id: "price_base" } },
            { id: "si_seat", price: { id: SEAT_PRICE_ID }, quantity: 2 },
          ],
        },
      });

      await request(app.getHttpServer())
        .post("/subscriptions/seats")
        .set("Authorization", `Bearer ${token}`)
        .send({ extraSeats: 0 })
        .expect(201);

      expect(subscriptionsUpdate).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ items: [{ id: "si_seat", deleted: true }] }),
      );
      const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
      expect(account.extraSeats).toBe(0);
    });

    it("refuses to cut seats below what's already in use", async () => {
      const { token, accountId } = await signUp();
      await centreWithSubscription(token, accountId);
      await prisma.account.update({ where: { id: accountId }, data: { extraSeats: 2 } });
      // Owner (1) + 3 pending invites = 4 seats in use; limit is 3 + 2 = 5.
      for (let i = 0; i < 3; i += 1) {
        await prisma.invite.create({
          data: {
            accountId,
            email: `invitee${i}@centre.test`,
            role: "staff",
            token: randomUUID(),
            status: "pending",
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
      }

      // Dropping to 0 extra → limit 3, below the 4 in use → 409, no Stripe call.
      await request(app.getHttpServer())
        .post("/subscriptions/seats")
        .set("Authorization", `Bearer ${token}`)
        .send({ extraSeats: 0 })
        .expect(409);
      expect(subscriptionsUpdate).not.toHaveBeenCalled();
    });

    it("only an owner or admin can change seats", async () => {
      const { accountId } = await signUp();
      await centreWithSubscription("", accountId);
      const staffUserId = randomUUID();
      await prisma.membership.create({
        data: { accountId, userId: staffUserId, role: "staff", email: "staff@centre.test" },
      });
      const staffToken = await mintToken(staffUserId, "staff@centre.test");

      await request(app.getHttpServer())
        .post("/subscriptions/seats")
        .set("Authorization", `Bearer ${staffToken}`)
        .send({ extraSeats: 1 })
        .expect(403);
      expect(subscriptionsUpdate).not.toHaveBeenCalled();
    });

    it("reports the current seat summary", async () => {
      const { token, accountId } = await signUp();
      await centreWithSubscription(token, accountId);
      const response = await request(app.getHttpServer())
        .get("/subscriptions/seats")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      // Fresh Centre account: 3 included, 0 extra, just the owner using a seat.
      expect(response.body).toMatchObject({
        includedSeats: 3,
        extraSeats: 0,
        limit: 3,
        used: 1,
        seatPriceMinor: 500,
      });
    });
  });
});
