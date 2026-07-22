import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import {
  accountSchema,
  dashboardSummarySchema,
  planEntitlementSchema,
} from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";
import { PrismaService } from "../src/prisma/prisma.service";

describe("Accounts (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects requests with no bearer token", async () => {
    await request(app.getHttpServer()).get("/accounts/me").expect(401);
  });

  it("rejects /accounts/me before any account exists for the user", async () => {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .get("/accounts/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });

  it("signs up a new account and then fetches it via /accounts/me", async () => {
    const token = await mintToken(randomUUID());

    const signupResponse = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: "E2E Test Centre" })
      .expect(201);

    // Parsing through the shared contract schema both type-narrows the
    // response and verifies the API's real output matches what the
    // frontend is built against — not just this test's expectations.
    const signedUp = accountSchema.parse(signupResponse.body);
    expect(signedUp).toMatchObject({
      type: "organisation",
      name: "E2E Test Centre",
      planId: "free",
    });

    const meResponse = await request(app.getHttpServer())
      .get("/accounts/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const me = accountSchema.parse(meResponse.body);
    expect(me.id).toBe(signedUp.id);
  });

  it("never exposes the guest claim token via /accounts/me", async () => {
    const token = await mintToken(randomUUID());
    const signupResponse = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "individual", name: "Claim Secret Test" })
      .expect(201);
    const accountId = (signupResponse.body as { id: string }).id;

    // Simulate a claimable account by setting a token directly, then confirm the
    // API response body carries no trace of it (nor its expiry). The token is
    // unique per run so it can't collide with other accounts under the unique
    // constraint in the shared test DB.
    const secretToken = `claim-${randomUUID()}`;
    const prisma = app.get(PrismaService);
    await prisma.account.update({
      where: { id: accountId },
      data: { claimToken: secretToken, claimTokenExpiresAt: new Date() },
    });

    const meResponse = await request(app.getHttpServer())
      .get("/accounts/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const body = meResponse.body as Record<string, unknown>;
    expect(body.claimToken).toBeUndefined();
    expect(body.claim_token).toBeUndefined();
    expect(body.claimTokenExpiresAt).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(secretToken);
  });

  it("rejects a second signup for the same user", async () => {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: "First" })
      .expect(201);

    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: "Second" })
      .expect(409);
  });

  it("rejects an invalid account type", async () => {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "not-a-real-type", name: "Bad Type" })
      .expect(400);
  });

  async function signUp(): Promise<string> {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Centre ${randomUUID()}` })
      .expect(201);
    return token;
  }

  it("returns the plan entitlement for the current account", async () => {
    const token = await signUp();
    const response = await request(app.getHttpServer())
      .get("/accounts/me/entitlements")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const entitlement = planEntitlementSchema.parse(response.body);
    // A fresh account is on the free plan — no auto-send.
    expect(entitlement.planId).toBe("free");
    expect(entitlement.autoSendEnabled).toBe(false);
  });

  it("requires auth for the dashboard summary", async () => {
    await request(app.getHttpServer()).get("/accounts/me/summary").expect(401);
  });

  it("reports a zeroed summary for a brand-new account", async () => {
    const token = await signUp();
    const response = await request(app.getHttpServer())
      .get("/accounts/me/summary")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(dashboardSummarySchema.parse(response.body)).toEqual({
      recipientCount: 0,
      walletBalanceMinor: 0,
      pendingApprovals: 0,
      occasionsThisMonth: 0,
      activeOrders: 0,
      completedOrders: 0,
      hasOccasions: false,
      firstOrderPlaced: false,
    });
  });

  it("counts recipients and this-month occasions awaiting approval in the summary", async () => {
    const token = await signUp();
    const recipientResponse = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Sam", lastName: "Recipient" })
      .expect(201);
    const recipientId = (recipientResponse.body as { id: string }).id;

    // An occasion dated today is in the current calendar month and starts
    // pending_approval.
    const today = new Date().toISOString().slice(0, 10);
    await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "achievement", occasionDate: today, recipientId })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get("/accounts/me/summary")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const summary = dashboardSummarySchema.parse(response.body);
    expect(summary.recipientCount).toBe(1);
    expect(summary.pendingApprovals).toBe(1);
    expect(summary.occasionsThisMonth).toBe(1);
    expect(summary.activeOrders).toBe(0);
    // An occasion now exists, but nothing has been paid for yet.
    expect(summary.hasOccasions).toBe(true);
    expect(summary.firstOrderPlaced).toBe(false);
  });
});
