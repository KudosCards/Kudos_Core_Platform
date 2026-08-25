import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * Crediting a customer's wallet by hand — a goodwill gesture instead of a
 * discount code. It moves money with no payment behind it, so the interesting
 * tests are the ones about who may do it, what it refuses, and what it records.
 */
describe("Admin — wallet adjustment (e2e)", () => {
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

  async function account(): Promise<string> {
    const created = await prisma.account.create({
      data: { type: "organisation", name: `Wallet co ${randomUUID()}`, planId: "centre" },
    });
    return created.id;
  }

  function credit(token: string, accountId: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/admin/customers/${accountId}/wallet-adjustment`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  }

  async function balanceOf(accountId: string): Promise<number> {
    const { _sum } = await prisma.walletLedgerEntry.aggregate({
      where: { accountId },
      _sum: { amountMinor: true },
    });
    return _sum.amountMinor ?? 0;
  }

  it("credits the wallet and records who did it and why", async () => {
    const token = await adminToken();
    const accountId = await account();

    const response = await credit(token, accountId, {
      amountMinor: 1000,
      reason: "Goodwill — long-standing customer",
      requestId: randomUUID(),
    }).expect(201);

    expect((response.body as { balanceMinor: number }).balanceMinor).toBe(1000);
    expect(await balanceOf(accountId)).toBe(1000);

    const entry = await prisma.walletLedgerEntry.findFirstOrThrow({ where: { accountId } });
    expect(entry.type).toBe("adjustment");
    expect(entry.amountMinor).toBe(1000);
    // The ledger is append-only, so the running total is stored on the row.
    expect(entry.balanceAfterMinor).toBe(1000);
    // No payment sits behind an adjustment, so no VAT receipt either.
    expect(entry.stripeInvoiceId).toBeNull();

    const audit = await prisma.auditLogEntry.findFirstOrThrow({
      where: { accountId, action: "wallet_adjustment_applied" },
    });
    expect(audit.metadata).toMatchObject({
      amountMinor: 1000,
      reason: "Goodwill — long-standing customer",
    });
  });

  it("credits once when the same request is submitted twice", async () => {
    const token = await adminToken();
    const accountId = await account();
    const requestId = randomUUID();
    const body = { amountMinor: 2500, reason: "Double-clicked the button", requestId };

    await credit(token, accountId, body).expect(201);
    await credit(token, accountId, body).expect(201);

    // A duplicate credit is not self-correcting — somebody has to notice it —
    // so the second submission must be a no-op, not a second £25.
    expect(await balanceOf(accountId)).toBe(2500);
    expect(await prisma.walletLedgerEntry.count({ where: { accountId } })).toBe(1);
  });

  it("takes a credit back when it was wrong", async () => {
    const token = await adminToken();
    const accountId = await account();

    await credit(token, accountId, {
      amountMinor: 10_000,
      reason: "Meant to type one hundred pounds",
      requestId: randomUUID(),
    }).expect(201);
    await credit(token, accountId, {
      amountMinor: -9_000,
      reason: "Correcting the amount above",
      requestId: randomUUID(),
    }).expect(201);

    expect(await balanceOf(accountId)).toBe(1_000);
    // Corrected by a new row, never by editing the first: the ledger stays a
    // truthful record of what happened, including the mistake.
    expect(await prisma.walletLedgerEntry.count({ where: { accountId } })).toBe(2);
  });

  it("refuses a debit that would overdraw the wallet", async () => {
    const token = await adminToken();
    const accountId = await account();
    await credit(token, accountId, {
      amountMinor: 500,
      reason: "A small goodwill credit",
      requestId: randomUUID(),
    }).expect(201);

    await credit(token, accountId, {
      amountMinor: -600,
      reason: "Trying to take back more than is there",
      requestId: randomUUID(),
    }).expect(409);

    expect(await balanceOf(accountId)).toBe(500);
  });

  it("refuses an operator who isn't a super admin", async () => {
    const token = await adminToken("ops");
    const accountId = await account();
    await credit(token, accountId, {
      amountMinor: 1000,
      reason: "Should never apply",
      requestId: randomUUID(),
    }).expect(403);
    expect(await balanceOf(accountId)).toBe(0);
  });

  it("refuses a customer, however well formed the request", async () => {
    const accountId = await account();
    const token = await mintToken(randomUUID());
    await credit(token, accountId, {
      amountMinor: 1000,
      reason: "Crediting my own wallet",
      requestId: randomUUID(),
    }).expect(403);
    expect(await balanceOf(accountId)).toBe(0);
  });

  it("refuses amounts and reasons that shouldn't be accepted", async () => {
    const token = await adminToken();
    const accountId = await account();

    // Over the £1,000 guardrail — the slipped-decimal case.
    await credit(token, accountId, {
      amountMinor: 100_001,
      reason: "Far too much",
      requestId: randomUUID(),
    }).expect(400);
    // Zero would write a ledger row that says nothing happened.
    await credit(token, accountId, {
      amountMinor: 0,
      reason: "Nothing at all",
      requestId: randomUUID(),
    }).expect(400);
    // The reason is the record that makes this defensible, so it is required.
    await credit(token, accountId, {
      amountMinor: 1000,
      reason: "",
      requestId: randomUUID(),
    }).expect(400);

    expect(await balanceOf(accountId)).toBe(0);
  });

  it("404s for a customer that doesn't exist", async () => {
    const token = await adminToken();
    await credit(token, randomUUID(), {
      amountMinor: 1000,
      reason: "No such customer",
      requestId: randomUUID(),
    }).expect(404);
  });

  it("shows the adjusted balance on the customer's profile", async () => {
    const token = await adminToken();
    const accountId = await account();
    await credit(token, accountId, {
      amountMinor: 1500,
      reason: "Goodwill",
      requestId: randomUUID(),
    }).expect(201);

    const profile = await request(app.getHttpServer())
      .get(`/admin/customers/${accountId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect((profile.body as { wallet: { balanceMinor: number } }).wallet.balanceMinor).toBe(1500);
  });
});
