import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import type Stripe from "stripe";
import { STRIPE_CLIENT } from "../src/billing/stripe-client.provider";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * ADR 0040 assigns platform settings to super admin: "Super admin manages the
 * operator team and platform settings". `ops` is the schema default, and the
 * role every invited operator starts on.
 *
 * Six of the admin controller's mutating routes said so. Four did not — and one
 * of those creates a **live Stripe Price** against the production account. A
 * junior operator could also disable the send-by-5 SLA reminder platform-wide,
 * or rewrite the Christmas lead times for every tenant. See ADR 0187.
 */
describe("Platform settings are super-admin only (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    // The seat-price route provisions against the live Stripe account, so it is
    // mocked here: this suite asserts the guard refuses before anything reaches
    // Stripe, and must never depend on the network to prove it.
    const stripe = {
      prices: { list: jest.fn(() => Promise.resolve({ data: [] })), create: jest.fn() },
      products: { list: jest.fn(() => Promise.resolve({ data: [] })), create: jest.fn() },
    } as unknown as Stripe;
    app = await createTestApp([{ provide: STRIPE_CLIENT, useValue: stripe }]);
    prisma = app.get(PrismaService);
  });
  afterAll(async () => await app.close());

  async function adminToken(role: "super_admin" | "ops"): Promise<string> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId, role } });
    return mintToken(userId);
  }

  /** Every mutating route on the admin controller, with a body it would accept
   * were the caller allowed. */
  const MUTATIONS: { name: string; send: (t: string) => request.Test }[] = [
    {
      name: "POST billing/seat-price (creates a live Stripe Price)",
      send: (t) =>
        request(app.getHttpServer())
          .post("/admin/billing/seat-price")
          .set("Authorization", `Bearer ${t}`),
    },
    {
      name: "PUT dispatch/seasonal-rules",
      send: (t) =>
        request(app.getHttpServer())
          .put("/admin/dispatch/seasonal-rules")
          .set("Authorization", `Bearer ${t}`)
          .send({ rules: [] }),
    },
    {
      name: "PUT dispatch/reminder-config (the send-by-5 SLA)",
      send: (t) =>
        request(app.getHttpServer())
          .put("/admin/dispatch/reminder-config")
          .set("Authorization", `Bearer ${t}`)
          .send({
            enabled: false,
            sendHourLondon: 7,
            leadWorkingDays: 5,
            escalateAfterWorkingDays: 2,
            sameDayCutoffHour: 15,
          }),
    },
    {
      name: "PUT print/card-size",
      send: (t) =>
        request(app.getHttpServer())
          .put("/admin/print/card-size")
          .set("Authorization", `Bearer ${t}`)
          .send({ size: "A5" }),
    },
  ];

  it.each(MUTATIONS)("refuses $name to an ops operator", async ({ send }) => {
    const ops = await adminToken("ops");
    await send(ops).expect(403);
  });

  it("still lets an ops operator read the same settings", async () => {
    // Reading config is an operator's job — the restriction is on changing it,
    // not on seeing it, and narrowing the reads would break the ops screens.
    const ops = await adminToken("ops");
    for (const path of [
      "/admin/dispatch/seasonal-rules",
      "/admin/dispatch/reminder-config",
      "/admin/print/card-size",
      "/admin/billing/seat-price",
    ]) {
      await request(app.getHttpServer())
        .get(path)
        .set("Authorization", `Bearer ${ops}`)
        .expect(200);
    }
  });

  it("still lets a super admin change them", async () => {
    const superAdmin = await adminToken("super_admin");
    await request(app.getHttpServer())
      .put("/admin/print/card-size")
      .set("Authorization", `Bearer ${superAdmin}`)
      .send({ size: "A5" })
      .expect(200);
  });
});
