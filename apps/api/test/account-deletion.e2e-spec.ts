import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PrismaService } from "../src/prisma/prisma.service";
import { STRIPE_CLIENT } from "../src/billing/stripe-client.provider";
import { SUPABASE_ADMIN_CLIENT } from "../src/supabase/supabase-admin.provider";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

describe("Account deletion (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let subscriptionsCancel: jest.Mock;
  let deleteUser: jest.Mock;

  beforeAll(async () => {
    subscriptionsCancel = jest.fn().mockResolvedValue({});
    deleteUser = jest.fn().mockResolvedValue({ data: {}, error: null });
    const mockStripe = {
      subscriptions: { cancel: subscriptionsCancel },
    } as unknown as Stripe;
    const mockSupabaseAdmin = {
      auth: { admin: { deleteUser } },
    } as unknown as SupabaseClient;

    app = await createTestApp([
      { provide: STRIPE_CLIENT, useValue: mockStripe },
      { provide: SUPABASE_ADMIN_CLIENT, useValue: mockSupabaseAdmin },
    ]);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    subscriptionsCancel.mockClear();
    deleteUser.mockClear();
  });

  async function signUp(): Promise<{
    token: string;
    userId: string;
    accountId: string;
    name: string;
  }> {
    const userId = randomUUID();
    const token = await mintToken(userId);
    const name = `Test Centre ${randomUUID()}`;
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name })
      .expect(201);
    return { token, userId, accountId: accountSchema.parse(response.body).id, name };
  }

  it("rejects deletion when the typed name doesn't match", async () => {
    const { token } = await signUp();
    await request(app.getHttpServer())
      .delete("/accounts/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ confirmName: "not the name" })
      .expect(400);
    expect(subscriptionsCancel).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("cancels the subscription, cascades all data, and removes the login", async () => {
    const { token, userId, accountId, name } = await signUp();

    // Some account-scoped data to prove the cascade removes it.
    await prisma.recipient.create({
      data: { accountId, firstName: "Ada", lastName: "Lovelace" },
    });
    const subscriptionId = `sub_${randomUUID()}`;
    await prisma.subscription.create({
      data: {
        accountId,
        planId: "pro",
        stripeSubscriptionId: subscriptionId,
        status: "active",
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
      },
    });

    await request(app.getHttpServer())
      .delete("/accounts/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ confirmName: name })
      .expect(204);

    expect(subscriptionsCancel).toHaveBeenCalledWith(subscriptionId);
    expect(deleteUser).toHaveBeenCalledWith(userId);
    expect(await prisma.account.findUnique({ where: { id: accountId } })).toBeNull();
    expect(await prisma.recipient.count({ where: { accountId } })).toBe(0);
    expect(await prisma.subscription.count({ where: { accountId } })).toBe(0);

    // The token now resolves to no membership → the app is inaccessible.
    await request(app.getHttpServer())
      .get("/accounts/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });

  it("blocks deletion while a card is in production or in the post", async () => {
    const { token, accountId, name } = await signUp();

    const [template] = await prisma.cardDesign.findMany({ take: 1 });
    const design = await prisma.savedDesign.create({
      data: {
        accountId,
        cardDesignId: template?.id ?? null,
        name: "Order design",
        document: { version: 1, pages: [] },
      },
    });
    const recipient = await prisma.recipient.create({
      data: {
        accountId,
        firstName: "Grace",
        lastName: "Hopper",
        addressLine1: "1 Navy Way",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
      },
    });
    const order = await prisma.batchOrder.create({ data: { accountId, status: "fulfilling" } });
    await prisma.orderRecipient.create({
      data: {
        batchOrderId: order.id,
        recipientId: recipient.id,
        savedDesignId: design.id,
        shippingAddressLine1: "1 Navy Way",
        shippingAddressCity: "London",
        shippingAddressPostcode: "SW1A 1AA",
        dispatchOption: "asap",
        postageClass: "second_class",
        priceMinor: 500,
        status: "posted",
      },
    });

    await request(app.getHttpServer())
      .delete("/accounts/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ confirmName: name })
      .expect(409);

    // Nothing was touched — the account and its data are intact.
    expect(await prisma.account.findUnique({ where: { id: accountId } })).not.toBeNull();
    expect(subscriptionsCancel).not.toHaveBeenCalled();
  });
});
