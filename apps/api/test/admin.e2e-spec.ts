import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { accountSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import Stripe from "stripe";
import { z } from "zod";
import { PrismaService } from "../src/prisma/prisma.service";
import type { EnvConfig } from "../src/config/env.schema";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

const overviewSchema = z.object({
  accounts: z.object({
    total: z.number(),
    organisations: z.number(),
    individuals: z.number(),
  }),
  subscribersByPlan: z.array(z.object({ plan: z.string(), count: z.number() })),
  activeSubscriptions: z.number(),
  atRiskCount: z.number(),
  orders: z.object({ paid: z.number(), last30Days: z.number() }),
  revenueMinor: z.object({ allTime: z.number(), last30Days: z.number() }),
  monthlyRevenueMinor: z.array(z.object({ label: z.string(), minor: z.number() })),
  cardsSent: z.number(),
  funnel: z.object({
    signedUp: z.number(),
    placedFirstOrder: z.number(),
    cardsFulfilled: z.number(),
  }),
  needsAttention: z.array(
    z.object({ id: z.string(), name: z.string(), lastActivityDays: z.number() }),
  ),
});

const orderRowSchema = z.object({
  id: z.string(),
  orderNumber: z.number(),
  accountId: z.string(),
  accountName: z.string(),
  status: z.string(),
  totalMinor: z.number(),
  currency: z.string(),
  cardCount: z.number(),
  paymentMethod: z.string().nullable(),
  createdAt: z.coerce.date(),
});

const subscriberRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  plan: z.string(),
  health: z.enum(["active", "at_risk", "churned", "none"]),
  createdAt: z.coerce.date(),
  lastActivityAt: z.coerce.date(),
  orderCount: z.number(),
  cardsSent: z.number(),
  totalSpentMinor: z.number(),
  hasStripeCustomer: z.boolean(),
});

const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), total: z.number(), page: z.number(), perPage: z.number() });

describe("Admin — super admin dashboard (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let webhookSecret: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    webhookSecret = app
      .get(ConfigService<EnvConfig, true>)
      .get("STRIPE_WEBHOOK_SECRET", { infer: true });
  });

  afterAll(async () => {
    await app.close();
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

  async function createAdmin(): Promise<string> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId } });
    return mintToken(userId);
  }

  function buildEvent(dataObject: Record<string, unknown>): string {
    return JSON.stringify({
      id: `evt_${randomUUID()}`,
      object: "event",
      api_version: "2025-01-01",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 0,
      request: null,
      type: "checkout.session.completed",
      data: { object: dataObject },
    });
  }

  function postWebhook(payload: string) {
    const signature = new Stripe("sk_test_x").webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    });
    return request(app.getHttpServer())
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(payload);
  }

  /** Drives a signup all the way to a paid order and returns its ids + total. */
  async function createPaidOrder(): Promise<{ accountId: string; batchOrderId: string; totalMinor: number }> {
    const { token, accountId } = await signUp();

    const recipient = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Ada", lastName: "Lovelace" })
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
      buildEvent({ id: `cs_test_${randomUUID()}`, metadata: { batchOrderId } }),
    ).expect(201);

    const stored = await prisma.batchOrder.findUniqueOrThrow({ where: { id: batchOrderId } });
    return { accountId, batchOrderId, totalMinor: stored.totalMinor };
  }

  it("requires platform-admin access (403 for a normal user, 401 for no token)", async () => {
    const { token } = await signUp();
    for (const path of ["/admin/overview", "/admin/orders", "/admin/subscribers"]) {
      await request(app.getHttpServer()).get(path).expect(401);
      await request(app.getHttpServer()).get(path).set("Authorization", `Bearer ${token}`).expect(403);
    }
  });

  it("overview reflects a paid order (counts, revenue, cards sent)", async () => {
    const adminToken = await createAdmin();
    const { totalMinor } = await createPaidOrder();

    const res = await request(app.getHttpServer())
      .get("/admin/overview")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const overview = overviewSchema.parse(res.body);

    expect(overview.accounts.total).toBeGreaterThanOrEqual(1);
    expect(overview.orders.paid).toBeGreaterThanOrEqual(1);
    expect(overview.revenueMinor.allTime).toBeGreaterThanOrEqual(totalMinor);
    expect(overview.cardsSent).toBeGreaterThanOrEqual(1);
    // New dashboard widgets.
    expect(overview.monthlyRevenueMinor).toHaveLength(12);
    expect(overview.funnel.signedUp).toBeGreaterThanOrEqual(1);
    expect(overview.funnel.placedFirstOrder).toBeGreaterThanOrEqual(1);
    // The paid order this test just made contributes to the latest month.
    const latestMonth = overview.monthlyRevenueMinor[overview.monthlyRevenueMinor.length - 1]!;
    expect(latestMonth.minor).toBeGreaterThanOrEqual(totalMinor);
  });

  it("lists orders cross-account, newest first, with account name + card count", async () => {
    const adminToken = await createAdmin();
    const { accountId, batchOrderId } = await createPaidOrder();

    const res = await request(app.getHttpServer())
      .get("/admin/orders?perPage=100")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const body = paginated(orderRowSchema).parse(res.body);

    // Just-created ⇒ newest ⇒ on the first page (desc by createdAt).
    const mine = body.items.find((o) => o.id === batchOrderId);
    expect(mine).toBeDefined();
    expect(mine!.accountId).toBe(accountId);
    expect(mine!.status).toBe("paid");
    expect(mine!.cardCount).toBe(1);
  });

  it("lists subscribers with per-account order count and spend", async () => {
    const adminToken = await createAdmin();
    const { accountId, totalMinor } = await createPaidOrder();

    const res = await request(app.getHttpServer())
      .get("/admin/subscribers?perPage=100")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const body = paginated(subscriberRowSchema).parse(res.body);

    const mine = body.items.find((s) => s.id === accountId);
    expect(mine).toBeDefined();
    expect(mine!.orderCount).toBe(1);
    expect(mine!.cardsSent).toBe(1);
    expect(mine!.totalSpentMinor).toBe(totalMinor);
  });
});
