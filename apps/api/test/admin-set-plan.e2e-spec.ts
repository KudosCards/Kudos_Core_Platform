import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * Setting a customer's plan by hand (ADR 0172).
 *
 * A plan is normally not ours to choose — it is written only by the Stripe
 * subscription webhook, from what the account is actually paying for. This grants
 * paid entitlements with no payment behind them, so the interesting tests are
 * who may do it, what it refuses, and what it records.
 */
describe("Admin — set plan (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function adminToken(role: "super_admin" | "ops" = "super_admin"): Promise<string> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId, role } });
    return mintToken(userId);
  }

  async function account(planId = "free"): Promise<string> {
    const created = await prisma.account.create({
      data: { type: "organisation", name: `Plan co ${randomUUID()}`, planId },
    });
    return created.id;
  }

  function setPlan(token: string, accountId: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/admin/customers/${accountId}/plan`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  }

  it("moves the account onto the plan and records who did it and why", async () => {
    const token = await adminToken();
    const accountId = await account("free");

    const response = await setPlan(token, accountId, {
      planId: "pro",
      reason: "Internal account used for platform testing",
    }).expect(201);

    expect(response.body).toEqual({ accountId, previousPlanId: "free", planId: "pro" });
    const stored = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(stored.planId).toBe("pro");

    const entry = await prisma.auditLogEntry.findFirst({
      where: { accountId, action: "plan_set_by_admin" },
    });
    expect(entry).not.toBeNull();
    expect(entry?.metadata).toMatchObject({
      fromPlanId: "free",
      toPlanId: "pro",
      reason: "Internal account used for platform testing",
    });
  });

  it("refuses an account with a live Stripe subscription", async () => {
    // The guard that makes this safe. The subscription webhook rewrites planId
    // on every event, so an override here would be reverted the next time Stripe
    // said anything — silently, and possibly weeks later.
    const token = await adminToken();
    const accountId = await account("pro");
    await prisma.subscription.create({
      data: {
        accountId,
        planId: "pro",
        stripeSubscriptionId: `sub_${randomUUID()}`,
        status: "active",
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
      },
    });

    const response = await setPlan(token, accountId, {
      planId: "centre",
      reason: "Trying to comp an upgrade",
    }).expect(409);
    expect((response.body as { message: string }).message).toContain("Stripe");

    // Unchanged — a refused override must not half-apply.
    const stored = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(stored.planId).toBe("pro");
  });

  it("allows it once the subscription is cancelled", async () => {
    // `canceled` is the one status that has released the account back to us, so
    // no future event will overwrite the plan.
    const token = await adminToken();
    const accountId = await account("pro");
    await prisma.subscription.create({
      data: {
        accountId,
        planId: "pro",
        stripeSubscriptionId: `sub_${randomUUID()}`,
        status: "canceled",
        currentPeriodEnd: new Date(),
      },
    });

    await setPlan(token, accountId, { planId: "pro", reason: "Comped after cancellation" }).expect(
      201,
    );
  });

  it("refuses a plan that isn't configured, and names the ones that are", async () => {
    // Left unchecked this would strand the account on a planId that
    // EntitlementsService cannot resolve, which throws on every send.
    const token = await adminToken();
    const accountId = await account("free");

    const response = await setPlan(token, accountId, {
      planId: "prro",
      reason: "Typo in the plan name",
    }).expect(404);
    expect((response.body as { message: string }).message).toContain("pro");

    const stored = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(stored.planId).toBe("free");
  });

  it("clears paid seats when moving to a plan without team seats", async () => {
    // Mirrors what the webhook does on cancellation: an account must not keep an
    // invite allowance its new plan doesn't include.
    const token = await adminToken();
    const accountId = await account("centre");
    await prisma.account.update({ where: { id: accountId }, data: { extraSeats: 4 } });

    await setPlan(token, accountId, { planId: "pro", reason: "Downgrade" }).expect(201);

    const stored = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(stored.extraSeats).toBe(0);
  });

  it("keeps paid seats when the new plan still has team seats", async () => {
    const token = await adminToken();
    const accountId = await account("centre");
    await prisma.account.update({ where: { id: accountId }, data: { extraSeats: 4 } });

    await setPlan(token, accountId, { planId: "centre", reason: "Re-applying the same plan" })
      .expect(201);

    const stored = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(stored.extraSeats).toBe(4);
  });

  it("is a no-op the second time, not an error", async () => {
    // Idempotent by nature, which is why there is no request id: setting the
    // same plan twice leaves the account exactly where it was.
    const token = await adminToken();
    const accountId = await account("free");

    await setPlan(token, accountId, { planId: "pro", reason: "First" }).expect(201);
    const second = await setPlan(token, accountId, { planId: "pro", reason: "Again" }).expect(201);
    expect(second.body).toEqual({ accountId, previousPlanId: "pro", planId: "pro" });
  });

  it("refuses an ops admin — this is super-admin only", async () => {
    const token = await adminToken("ops");
    const accountId = await account("free");

    await setPlan(token, accountId, { planId: "pro", reason: "Should not be allowed" }).expect(403);

    const stored = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(stored.planId).toBe("free");
  });

  it("requires a reason", async () => {
    const token = await adminToken();
    const accountId = await account("free");

    await setPlan(token, accountId, { planId: "pro" }).expect(400);
    await setPlan(token, accountId, { planId: "pro", reason: "x" }).expect(400);

    const stored = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(stored.planId).toBe("free");
  });

  it("404s for an account that doesn't exist", async () => {
    const token = await adminToken();
    await setPlan(token, randomUUID(), { planId: "pro", reason: "No such account" }).expect(404);
  });
});
