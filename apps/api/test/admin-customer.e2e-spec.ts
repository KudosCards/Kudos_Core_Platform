import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { customer360Schema } from "@kudos/shared-types";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

describe("Admin — Customer 360 (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function operatorToken(): Promise<string> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId, role: "super_admin" } });
    return mintToken(userId);
  }

  it("refuses a non-operator", async () => {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .get(`/admin/customers/${randomUUID()}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });

  it("404s for an unknown customer", async () => {
    const token = await operatorToken();
    await request(app.getHttpServer())
      .get(`/admin/customers/${randomUUID()}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
  });

  it("aggregates a customer's full engagement profile", async () => {
    const token = await operatorToken();

    const account = await prisma.account.create({
      data: {
        type: "organisation",
        name: `Engaged Centre ${randomUUID()}`,
        planId: "centre",
        stripeCustomerId: `cus_${randomUUID()}`,
        extraSeats: 1,
      },
    });
    const accountId = account.id;

    await prisma.membership.createMany({
      data: [
        { accountId, userId: randomUUID(), role: "owner", email: "owner@centre.test" },
        { accountId, userId: randomUUID(), role: "staff", email: "colleague@centre.test" },
      ],
    });

    // 5 contacts across sources and statuses; one needs address re-verification.
    await prisma.recipient.createMany({
      data: [
        { accountId, firstName: "A1", lastName: "M", source: "manual", status: "active" },
        {
          accountId,
          firstName: "A2",
          lastName: "M",
          source: "manual",
          status: "active",
          addressVerificationRequired: true,
        },
        { accountId, firstName: "C1", lastName: "M", source: "csv", status: "active" },
        {
          accountId,
          firstName: "B1",
          lastName: "M",
          source: "brevo",
          externalId: "brevo-1",
          status: "lapsed",
        },
        { accountId, firstName: "X1", lastName: "M", source: "manual", status: "archived" },
      ],
    });
    const firstRecipient = await prisma.recipient.findFirstOrThrow({ where: { accountId } });

    await prisma.recipientList.create({ data: { accountId, name: "Year 4" } });

    await prisma.occasion.createMany({
      data: [
        {
          accountId,
          recipientId: firstRecipient.id,
          type: "birthday",
          source: "recurring_per_recipient",
          occasionDate: new Date("2030-06-01"),
          status: "scheduled",
        },
        {
          accountId,
          recipientId: firstRecipient.id,
          type: "seasonal",
          source: "recurring_per_recipient",
          occasionDate: new Date("2030-12-01"),
          status: "scheduled",
          dispatchOption: "auto_send",
        },
      ],
    });

    await prisma.crmConnection.create({
      data: {
        accountId,
        provider: "brevo",
        encryptedApiKey: "enc",
        lastSyncedAt: new Date(),
        lastSyncStatus: "ok",
      },
    });
    await prisma.accountApiKey.create({
      data: {
        accountId,
        label: "Zapier",
        keyHash: randomUUID(),
        prefix: "kudos_ab",
        lastUsedAt: new Date(),
      },
    });
    await prisma.walletLedgerEntry.create({
      data: { accountId, type: "topup", amountMinor: 5000, balanceAfterMinor: 5000 },
    });
    await prisma.subscription.create({
      data: {
        accountId,
        planId: "centre",
        stripeSubscriptionId: `sub_${randomUUID()}`,
        status: "active",
        currentPeriodEnd: new Date("2030-01-01"),
      },
    });

    const savedDesign = await prisma.savedDesign.create({
      data: { accountId, name: "Design", document: {} },
    });
    const order = await prisma.batchOrder.create({
      data: {
        accountId,
        status: "paid",
        currency: "GBP",
        subtotalMinor: 1200,
        totalMinor: 1200,
        paymentMethod: "wallet",
      },
    });
    // Two cards on the order → cardsSent === 2.
    for (const rid of [firstRecipient.id]) {
      await prisma.orderRecipient.create({
        data: {
          batchOrderId: order.id,
          recipientId: rid,
          savedDesignId: savedDesign.id,
          shippingAddressLine1: "1 St",
          shippingAddressCity: "London",
          shippingAddressPostcode: "SW1",
          dispatchOption: "asap",
          postageClass: "second_class",
          priceMinor: 600,
        },
      });
    }
    const secondCard = await prisma.orderRecipient.create({
      data: {
        batchOrderId: order.id,
        recipientId: firstRecipient.id,
        savedDesignId: savedDesign.id,
        shippingAddressLine1: "1 St",
        shippingAddressCity: "London",
        shippingAddressPostcode: "SW1",
        dispatchOption: "asap",
        postageClass: "second_class",
        priceMinor: 600,
      },
    });
    await prisma.messagePage.create({
      data: {
        accountId,
        title: "Test",
        links: { create: { slug: randomUUID(), orderRecipientId: secondCard.id, viewCount: 3 } },
      },
    });

    const response = await request(app.getHttpServer())
      .get(`/admin/customers/${accountId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const customer = customer360Schema.parse(response.body);

    expect(customer.contacts).toMatchObject({
      total: 5,
      active: 3,
      lapsed: 1,
      archived: 1,
      needsAddress: 1,
      listCount: 1,
    });
    const sources = Object.fromEntries(customer.contacts.bySource.map((s) => [s.source, s.count]));
    expect(sources).toMatchObject({ manual: 3, csv: 1, brevo: 1 });

    expect(customer.occasions.scheduled).toBe(2);
    expect(customer.occasions.autoSend).toBe(1);

    // An abandoned occasion is not an auto-send an operator can act on. This
    // count read `status: { not: skipped }`, so it began counting `missed` the
    // moment that status existed — quietly inflating a customer's profile with
    // dead rows.
    for (const status of ["skipped", "missed"] as const) {
      await prisma.occasion.create({
        data: {
          accountId,
          recipientId: firstRecipient.id,
          type: "seasonal",
          source: "recurring_per_recipient",
          occasionDate: new Date(status === "skipped" ? "2030-12-05" : "2030-12-06"),
          status,
          dispatchOption: "auto_send",
        },
      });
    }
    const afterAbandoned = customer360Schema.parse(
      (
        await request(app.getHttpServer())
          .get(`/admin/customers/${accountId}`)
          .set("Authorization", `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    expect(afterAbandoned.occasions.autoSend).toBe(1);

    expect(customer.integrations.crm).toHaveLength(1);
    expect(customer.integrations.apiKeys).toHaveLength(1);
    expect(customer.wallet.balanceMinor).toBe(5000);

    expect(customer.orders).toMatchObject({ count: 1, cardsSent: 2, totalSpentMinor: 1200 });
    expect(customer.messages).toMatchObject({ pageCount: 1, totalViews: 3 });

    expect(customer.team.memberCount).toBe(2);
    expect(customer.team.seatLimit).toBeGreaterThanOrEqual(2);

    expect(customer.subscription?.active).toBe(true);
    expect(customer.health).toBe("active");
    expect(customer.engagement.level).toBe("activated");
    expect(customer.engagement.signals).toMatchObject({
      hasContacts: true,
      hasOccasions: true,
      hasIntegration: true,
      hasOrder: true,
      hasTeam: true,
    });
  });
  it("reports no subscription spend for an account that has never paid", async () => {
    const token = await operatorToken();
    const account = await prisma.account.create({
      data: { type: "individual", name: `Never Paid ${randomUUID()}`, planId: "free" },
    });

    const response = await request(app.getHttpServer())
      .get(`/admin/customers/${account.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const customer = customer360Schema.parse(response.body);
    expect(customer.subscriptionSpend).toMatchObject({
      totalPaidMinor: 0,
      invoiceCount: 0,
      firstPaidAt: null,
      lastPaidAt: null,
      recent: [],
    });
    // With nothing to report we still name a currency, so the page has
    // something to format zero with.
    expect(customer.subscriptionSpend.currency).toBe("gbp");
  });

  it("totals lifetime subscription spend and lists the most recent invoices", async () => {
    const token = await operatorToken();
    const account = await prisma.account.create({
      data: {
        type: "organisation",
        name: `Long Standing ${randomUUID()}`,
        planId: "centre",
        stripeCustomerId: `cus_${randomUUID()}`,
      },
    });
    const accountId = account.id;

    // 14 monthly invoices — two more than the page shows, so the cap and the
    // "latest N of M" count are both exercised.
    const MONTHS = 14;
    for (let i = 0; i < MONTHS; i += 1) {
      const paidAt = new Date(Date.UTC(2025, i, 3, 9, 0, 0));
      await prisma.subscriptionInvoice.create({
        data: {
          accountId,
          stripeInvoiceId: `in_${randomUUID()}`,
          stripeSubscriptionId: "sub_long_standing",
          // A rising amount makes the ordering assertion meaningful: the
          // newest invoice is also the dearest.
          amountPaidMinor: 1000 + i,
          currency: "gbp",
          status: "paid",
          billingReason: i === 0 ? "subscription_create" : "subscription_cycle",
          periodStart: paidAt,
          periodEnd: new Date(Date.UTC(2025, i + 1, 3, 9, 0, 0)),
          paidAt,
          hostedInvoiceUrl: `https://invoice.stripe.test/${i}`,
          invoicePdfUrl: `https://invoice.stripe.test/${i}.pdf`,
        },
      });
    }

    // Another account's invoice must not leak into this one's total.
    const other = await prisma.account.create({
      data: { type: "individual", name: `Other ${randomUUID()}`, planId: "starter" },
    });
    await prisma.subscriptionInvoice.create({
      data: {
        accountId: other.id,
        stripeInvoiceId: `in_${randomUUID()}`,
        amountPaidMinor: 999_999,
        currency: "gbp",
        status: "paid",
        paidAt: new Date(Date.UTC(2025, 5, 1)),
      },
    });

    const response = await request(app.getHttpServer())
      .get(`/admin/customers/${accountId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const { subscriptionSpend } = customer360Schema.parse(response.body);

    // 1000 + 1001 + … + 1013
    const expectedTotal = MONTHS * 1000 + (MONTHS * (MONTHS - 1)) / 2;
    expect(subscriptionSpend.totalPaidMinor).toBe(expectedTotal);
    expect(subscriptionSpend.invoiceCount).toBe(MONTHS);
    expect(subscriptionSpend.currency).toBe("gbp");
    expect(subscriptionSpend.firstPaidAt).toEqual(new Date(Date.UTC(2025, 0, 3, 9, 0, 0)));
    expect(subscriptionSpend.lastPaidAt).toEqual(new Date(Date.UTC(2025, MONTHS - 1, 3, 9, 0, 0)));

    // Newest first, capped at the page's 12.
    expect(subscriptionSpend.recent).toHaveLength(12);
    expect(subscriptionSpend.recent[0]?.amountPaidMinor).toBe(1000 + MONTHS - 1);
    expect(subscriptionSpend.recent[0]?.billingReason).toBe("subscription_cycle");
    expect(subscriptionSpend.recent[0]?.hostedInvoiceUrl).toBe(
      `https://invoice.stripe.test/${MONTHS - 1}`,
    );
    const paidTimes = subscriptionSpend.recent.map((i) => i.paidAt.getTime());
    expect(paidTimes).toEqual([...paidTimes].sort((a, b) => b - a));
  });
});
