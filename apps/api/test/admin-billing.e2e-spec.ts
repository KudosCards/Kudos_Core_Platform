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

// This suite exercises the DB-backed (no env var) provisioning path, so ensure
// the env override is off before the app boots — it may leak in from another
// spec file in the same jest worker.
delete process.env.STRIPE_CENTRE_SEAT_PRICE_ID;

describe("Admin billing — in-app seat-price provisioning (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let pricesList: jest.Mock;
  let pricesCreate: jest.Mock;
  let subscriptionsRetrieve: jest.Mock;
  let subscriptionsUpdate: jest.Mock;

  beforeAll(async () => {
    pricesList = jest.fn();
    pricesCreate = jest.fn();
    subscriptionsRetrieve = jest.fn();
    subscriptionsUpdate = jest.fn();
    const mockStripe = {
      prices: { list: pricesList, create: pricesCreate },
      subscriptions: { retrieve: subscriptionsRetrieve, update: subscriptionsUpdate },
    } as unknown as Stripe;
    app = await createTestApp([{ provide: STRIPE_CLIENT, useValue: mockStripe }]);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    pricesList.mockReset();
    pricesCreate.mockReset();
    subscriptionsRetrieve.mockReset();
    subscriptionsUpdate.mockReset().mockResolvedValue({});
    // Clean state each test — no stored seat price id.
    await prisma.platformSetting.deleteMany({});
  });

  async function createOpsAdmin(): Promise<string> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId } });
    return mintToken(userId);
  }

  async function centreAccount(): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID());
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Test Centre ${randomUUID()}` })
      .expect(201);
    const accountId = accountSchema.parse(response.body).id;
    await prisma.account.update({ where: { id: accountId }, data: { planId: "centre" } });
    await prisma.subscription.create({
      data: {
        accountId,
        planId: "centre",
        stripeSubscriptionId: `sub_test_${randomUUID()}`,
        status: "active",
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    return { token, accountId };
  }

  it("reports unconfigured before provisioning", async () => {
    const ops = await createOpsAdmin();
    const res = await request(app.getHttpServer())
      .get("/admin/billing/seat-price")
      .set("Authorization", `Bearer ${ops}`)
      .expect(200);
    expect(res.body).toEqual({ priceId: null, source: "unconfigured" });
  });

  it("creates the Stripe seat price and stores it — no env var, no redeploy", async () => {
    const ops = await createOpsAdmin();
    pricesList.mockResolvedValue({ data: [] }); // none exists yet
    pricesCreate.mockResolvedValue({ id: "price_seat_created" });

    const res = await request(app.getHttpServer())
      .post("/admin/billing/seat-price")
      .set("Authorization", `Bearer ${ops}`)
      .expect(201);

    expect(res.body).toEqual({ priceId: "price_seat_created", source: "platform_setting" });
    // Created as a £5/mo GBP VAT-inclusive recurring price.
    const [createArgs] = pricesCreate.mock.calls[0] as [Stripe.PriceCreateParams];
    expect(createArgs).toMatchObject({
      currency: "gbp",
      unit_amount: 500,
      recurring: { interval: "month" },
      tax_behavior: "inclusive",
      lookup_key: "kudos_centre_seat_monthly",
    });
    // Stored, so status now reports it.
    const status = await request(app.getHttpServer())
      .get("/admin/billing/seat-price")
      .set("Authorization", `Bearer ${ops}`)
      .expect(200);
    expect(status.body).toEqual({ priceId: "price_seat_created", source: "platform_setting" });
  });

  it("is idempotent — a second call reuses the stored id without creating again", async () => {
    const ops = await createOpsAdmin();
    pricesList.mockResolvedValue({ data: [] });
    pricesCreate.mockResolvedValue({ id: "price_seat_created" });

    await request(app.getHttpServer())
      .post("/admin/billing/seat-price")
      .set("Authorization", `Bearer ${ops}`)
      .expect(201);
    await request(app.getHttpServer())
      .post("/admin/billing/seat-price")
      .set("Authorization", `Bearer ${ops}`)
      .expect(201);

    expect(pricesCreate).toHaveBeenCalledTimes(1);
  });

  it("reuses an existing Stripe price found by lookup_key (e.g. from the script)", async () => {
    const ops = await createOpsAdmin();
    pricesList.mockResolvedValue({ data: [{ id: "price_seat_existing" }] });

    const res = await request(app.getHttpServer())
      .post("/admin/billing/seat-price")
      .set("Authorization", `Bearer ${ops}`)
      .expect(201);

    expect(res.body).toEqual({ priceId: "price_seat_existing", source: "platform_setting" });
    expect(pricesCreate).not.toHaveBeenCalled();
  });

  it("lets a Centre account buy a seat afterwards using the stored price — proving the DB path drives billing", async () => {
    const ops = await createOpsAdmin();
    pricesList.mockResolvedValue({ data: [] });
    pricesCreate.mockResolvedValue({ id: "price_seat_created" });
    await request(app.getHttpServer())
      .post("/admin/billing/seat-price")
      .set("Authorization", `Bearer ${ops}`)
      .expect(201);

    const { token } = await centreAccount();
    // The subscription has no seat item yet.
    subscriptionsRetrieve.mockResolvedValue({
      items: { data: [{ id: "si_base", price: { id: "price_base" } }] },
    });

    const res = await request(app.getHttpServer())
      .post("/subscriptions/seats")
      .set("Authorization", `Bearer ${token}`)
      .send({ extraSeats: 1 })
      .expect(201);

    expect(res.body).toMatchObject({ includedSeats: 3, extraSeats: 1, limit: 4 });
    // The seat change used the stored (DB) price id, not any env var.
    expect(subscriptionsUpdate).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ items: [{ price: "price_seat_created", quantity: 1 }] }),
    );
  });

  it("refuses provisioning to a non-platform-admin", async () => {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/admin/billing/seat-price")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
    await request(app.getHttpServer())
      .get("/admin/billing/seat-price")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });
});
