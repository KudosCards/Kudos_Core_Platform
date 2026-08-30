import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { accountSchema, adminOrderDetailSchema } from "@kudos/shared-types";
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

const progressSchema = z.object({
  total: z.number(),
  pending: z.number(),
  inProgress: z.number(),
  printed: z.number(),
  posted: z.number(),
  delivered: z.number(),
  returnedToSender: z.number(),
  failed: z.number(),
  imported: z.number(),
  importErrors: z.number(),
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
  progress: progressSchema,
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
  recipientCount: z.number(),
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

  /** A super admin, which is what the privileged routes in this suite need. The
   * role used to be omitted — defaulting to `ops` — which is how the seasonal
   * rules test passed against a mutation that should have refused it. That an
   * `ops` operator can still *read* these settings is covered in
   * admin-platform-settings.e2e-spec.ts. See ADR 0187. */
  async function createAdmin(role: "super_admin" | "ops" = "super_admin"): Promise<string> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId, role } });
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
      // buildEvent only builds checkout.session.completed here; default a paid
      // status so these order-payment fixtures settle under the webhook's guard.
      data: {
        object:
          dataObject.payment_status === undefined
            ? { payment_status: "paid", ...dataObject }
            : dataObject,
      },
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
  async function createPaidOrder(): Promise<{
    accountId: string;
    batchOrderId: string;
    totalMinor: number;
  }> {
    const { token, accountId } = await signUp();

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
      buildEvent({ id: `cs_test_${randomUUID()}`, metadata: { batchOrderId } }),
    ).expect(201);

    const stored = await prisma.batchOrder.findUniqueOrThrow({ where: { id: batchOrderId } });
    return { accountId, batchOrderId, totalMinor: stored.totalMinor };
  }

  it("requires platform-admin access (403 for a normal user, 401 for no token)", async () => {
    const { token } = await signUp();
    for (const path of ["/admin/overview", "/admin/orders", "/admin/subscribers"]) {
      await request(app.getHttpServer()).get(path).expect(401);
      await request(app.getHttpServer())
        .get(path)
        .set("Authorization", `Bearer ${token}`)
        .expect(403);
    }
  });

  it("reads, validates, updates and resets the seasonal dispatch windows", async () => {
    const adminToken = await createAdmin();
    const { token } = await signUp();

    // Non-admins are refused.
    await request(app.getHttpServer())
      .get("/admin/dispatch/seasonal-rules")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);

    // Read: the active rules + the bundled default (for the reset button).
    const initial = await request(app.getHttpServer())
      .get("/admin/dispatch/seasonal-rules")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const initialBody = initial.body as { rules: unknown[]; default: { label: string }[] };
    expect(initialBody.default.some((r) => r.label === "Christmas post rush")).toBe(true);
    const defaultRules = initialBody.default;

    // A bad window (day 40) is rejected.
    await request(app.getHttpServer())
      .put("/admin/dispatch/seasonal-rules")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        rules: [
          {
            label: "Bad",
            from: { month: 1, day: 40 },
            to: { month: 1, day: 2 },
            extraLeadDays: 1,
            suggestFirstClass: false,
          },
        ],
      })
      .expect(400);

    // A valid update is stored and echoed back.
    const custom = [
      {
        label: "Summer holidays",
        from: { month: 7, day: 15 },
        to: { month: 8, day: 31 },
        extraLeadDays: 2,
        suggestFirstClass: false,
      },
    ];
    const updated = await request(app.getHttpServer())
      .put("/admin/dispatch/seasonal-rules")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ rules: custom })
      .expect(200);
    expect((updated.body as { rules: { label: string }[] }).rules[0]?.label).toBe(
      "Summer holidays",
    );

    const afterUpdate = await request(app.getHttpServer())
      .get("/admin/dispatch/seasonal-rules")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect((afterUpdate.body as { rules: { label: string }[] }).rules).toHaveLength(1);

    // Reset so this test can't affect other suites' dispatch-date maths.
    await request(app.getHttpServer())
      .put("/admin/dispatch/seasonal-rules")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ rules: defaultRules })
      .expect(200);
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

    // The per-plan breakdown must account for every signed-up account exactly
    // once (this is what the null-planId → "free" bucketing in the DB-side
    // aggregate guarantees).
    const plannedTotal = overview.subscribersByPlan.reduce((sum, p) => sum + p.count, 0);
    expect(plannedTotal).toBe(overview.accounts.total);
  });

  it("flags an account with no active subscription and no recent activity as at-risk", async () => {
    const adminToken = await createAdmin();
    const { accountId } = await signUp();

    // Backdate signup to 40 days ago with no subscription and no orders, so its
    // only activity signal (signup) is well past the 30-day at-risk threshold.
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await prisma.account.update({
      where: { id: accountId },
      data: { createdAt: fortyDaysAgo },
    });

    const res = await request(app.getHttpServer())
      .get("/admin/overview")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const overview = overviewSchema.parse(res.body);

    expect(overview.atRiskCount).toBeGreaterThanOrEqual(1);
    const flagged = overview.needsAttention.find((a) => a.id === accountId);
    expect(flagged).toBeDefined();
    // ~40 days idle (allow a day of slack for timing).
    expect(flagged!.lastActivityDays).toBeGreaterThanOrEqual(39);
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
    // Real fulfilment progress, not a status label: a freshly-paid order has one
    // pending job, nothing posted yet.
    expect(mine!.progress.total).toBe(1);
    expect(mine!.progress.pending).toBe(1);
    expect(mine!.progress.posted).toBe(0);
  });

  it("filters orders server-side by search + paginates (no 100-order cap)", async () => {
    const adminToken = await createAdmin();
    const { batchOrderId } = await createPaidOrder();
    const orderNumber = (await prisma.batchOrder.findUniqueOrThrow({ where: { id: batchOrderId } }))
      .orderNumber;

    // Search by the human order number resolves in SQL — it finds the order even
    // if it's far past the newest 100 (the old in-memory filter would miss it).
    const found = await request(app.getHttpServer())
      .get(`/admin/orders?search=${orderNumber}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const foundBody = paginated(orderRowSchema).parse(found.body);
    expect(foundBody.items.some((o) => o.id === batchOrderId)).toBe(true);

    // A search that can't match excludes it.
    const none = await request(app.getHttpServer())
      .get("/admin/orders?search=zzz-no-such-account-xyz")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const noneBody = paginated(orderRowSchema).parse(none.body);
    expect(noneBody.items.some((o) => o.id === batchOrderId)).toBe(false);

    // Pagination metadata is honoured.
    const paged = await request(app.getHttpServer())
      .get("/admin/orders?perPage=1&page=1")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const pagedBody = paginated(orderRowSchema).parse(paged.body);
    expect(pagedBody.items).toHaveLength(1);
    expect(pagedBody.perPage).toBe(1);
    expect(pagedBody.total).toBeGreaterThanOrEqual(1);
  });

  it("does not 500 when the order-number search overflows int4 range", async () => {
    const adminToken = await createAdmin();
    // A 21-digit numeric term exceeds int4 — the search must skip the
    // orderNumber clause rather than let Postgres reject the value.
    await request(app.getHttpServer())
      .get("/admin/orders?search=999999999999999999999")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
  });

  it("returns one order's detail: header, real progress, and card lines (no address)", async () => {
    const adminToken = await createAdmin();
    const { accountId, batchOrderId } = await createPaidOrder();

    const res = await request(app.getHttpServer())
      .get(`/admin/orders/${batchOrderId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const detail = adminOrderDetailSchema.parse(res.body);

    expect(detail.id).toBe(batchOrderId);
    expect(detail.accountId).toBe(accountId);
    expect(detail.cardCount).toBe(1);
    expect(detail.progress.total).toBe(1);
    expect(detail.progress.pending).toBe(1);
    expect(detail.lines).toHaveLength(1);
    const line = detail.lines[0]!;
    expect(line.recipientName).toBe("Ada Lovelace");
    expect(line.jobStatus).toBe("pending");
    expect(line.dueDate).not.toBeNull();
    // Milestone timestamps are exposed for the cockpit trail — all null until the
    // card is worked (it's still pending here). See ADR 0123.
    expect(line.printedAt).toBeNull();
    expect(line.postedAt).toBeNull();
    expect(line.deliveredAt).toBeNull();
    expect(line.labelUrl).toBeNull();

    // Data minimisation: the line must NOT carry the street address — that stays
    // behind the audited fulfilment export.
    expect(line).not.toHaveProperty("shippingAddressLine1");
    expect(JSON.stringify(res.body)).not.toContain("1 Test Street");
  });

  it("404s an unknown order detail and 403s a non-admin", async () => {
    const adminToken = await createAdmin();
    const { token } = await signUp();
    const { batchOrderId } = await createPaidOrder();

    await request(app.getHttpServer())
      .get(`/admin/orders/${randomUUID()}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .get(`/admin/orders/${batchOrderId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
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

  it("filters subscribers server-side by search + paginates (no 100-cap)", async () => {
    const adminToken = await createAdmin();
    const { accountId } = await createPaidOrder();
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    // The account name is `Test Centre <uuid>`; the uuid is a unique fragment.
    const uniqueFragment = account.name.split(" ").pop()!;

    // Name search resolves in SQL — it finds the account even far past the newest
    // 100 (the old in-memory client filter would miss it).
    const found = await request(app.getHttpServer())
      .get(`/admin/subscribers?search=${uniqueFragment}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const foundBody = paginated(subscriberRowSchema).parse(found.body);
    expect(foundBody.items.some((s) => s.id === accountId)).toBe(true);

    // A search that can't match excludes it.
    const none = await request(app.getHttpServer())
      .get("/admin/subscribers?search=zzz-no-such-account-xyz")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(
      paginated(subscriberRowSchema)
        .parse(none.body)
        .items.some((s) => s.id === accountId),
    ).toBe(false);

    // Pagination metadata is honoured.
    const paged = await request(app.getHttpServer())
      .get("/admin/subscribers?perPage=1&page=1")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const pagedBody = paginated(subscriberRowSchema).parse(paged.body);
    expect(pagedBody.items).toHaveLength(1);
    expect(pagedBody.perPage).toBe(1);
    expect(pagedBody.total).toBeGreaterThanOrEqual(1);
  });

  it("filters subscribers by plan, including free-plan accounts (planId 'free')", async () => {
    const adminToken = await createAdmin();
    const { accountId } = await signUp(); // a fresh signup defaults to planId = "free"

    // The Free filter must find it — the bug was matching planId=null, but signup
    // stores the string "free".
    const free = await request(app.getHttpServer())
      .get("/admin/subscribers?plan=free&perPage=100")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(
      paginated(subscriberRowSchema)
        .parse(free.body)
        .items.some((s) => s.id === accountId),
    ).toBe(true);

    // A paid-plan filter excludes the free account.
    const pro = await request(app.getHttpServer())
      .get("/admin/subscribers?plan=pro&perPage=100")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(
      paginated(subscriberRowSchema)
        .parse(pro.body)
        .items.some((s) => s.id === accountId),
    ).toBe(false);
  });
});
