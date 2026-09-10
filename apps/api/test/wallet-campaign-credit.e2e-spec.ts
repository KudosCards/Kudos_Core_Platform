import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import type { WalletCampaign } from "@prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { WalletService } from "../src/wallet/wallet.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * The campaign credit path — every rule that decides whether money moves.
 *
 * This is money with no payment behind it, granted automatically, so each check
 * is a read-then-write inside one serializable transaction. The test that
 * matters most is the concurrent one: a budget checked anywhere but inside that
 * transaction lets two accounts signing up together both take the last £5, and
 * every other assertion here would still pass.
 *
 * See docs/wallet-campaigns-plan.md.
 */
describe("Wallet campaign credit (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let wallet: WalletService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    wallet = app.get(WalletService);
  });

  afterAll(async () => {
    await app.close();
  });

  /** A signed-up account, created at `createdAt` so window rules can be tested
   *  without waiting for a calendar. */
  async function accountCreatedAt(createdAt: Date): Promise<string> {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Campaign co ${randomUUID()}` })
      .expect(201);
    const me = await request(app.getHttpServer())
      .get("/accounts/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const id = (me.body as { id: string }).id;
    await prisma.account.update({ where: { id }, data: { createdAt } });
    return id;
  }

  const OCTOBER_START = new Date("2026-10-01T00:00:00.000Z");
  const OCTOBER_END = new Date("2026-11-01T00:00:00.000Z");
  const IN_WINDOW = new Date("2026-10-15T12:00:00.000Z");

  async function campaign(overrides: Partial<WalletCampaign> = {}): Promise<WalletCampaign> {
    return prisma.walletCampaign.create({
      data: {
        name: `October ${randomUUID().slice(0, 8)}`,
        amountMinor: 500,
        startsAt: OCTOBER_START,
        endsAt: OCTOBER_END,
        budgetMinor: 100_000,
        status: "live",
        createdByUserId: randomUUID(),
        ...overrides,
      },
    });
  }

  const balanceOf = async (accountId: string): Promise<number> =>
    (await wallet.getSummary(accountId)).balanceMinor;

  it("credits a signup inside the window", async () => {
    const accountId = await accountCreatedAt(IN_WINDOW);
    const c = await campaign();

    expect(await wallet.creditCampaign(accountId, c, "buyer@example.com")).toEqual({
      status: "credited",
      amountMinor: 500,
    });
    expect(await balanceOf(accountId)).toBe(500);

    const [entry] = (await wallet.getSummary(accountId)).entries;
    expect(entry).toMatchObject({ type: "campaign", amountMinor: 500 });
    expect(entry!.reference).toBe(`campaign:${c.id}`);
  });

  it("writes the audit row in the same transaction as the money", async () => {
    // A credit that commits without the row saying who authorised it is money
    // with no record. ADR 0229 settled this for the date-of-birth edit.
    const accountId = await accountCreatedAt(IN_WINDOW);
    const c = await campaign();

    await wallet.creditCampaign(accountId, c, "buyer@example.com");

    const audit = await prisma.auditLogEntry.findFirst({
      where: { accountId, action: "wallet_campaign_credited" },
    });
    expect(audit).not.toBeNull();
    expect(audit!.metadata).toMatchObject({ campaignId: c.id, amountMinor: 500 });
  });

  it("credits an account once, however many times it is asked", async () => {
    const accountId = await accountCreatedAt(IN_WINDOW);
    const c = await campaign();

    await wallet.creditCampaign(accountId, c, "buyer@example.com");
    expect(await wallet.creditCampaign(accountId, c, "buyer@example.com")).toEqual({
      status: "already_credited",
    });
    expect(await balanceOf(accountId)).toBe(500);
  });

  it("credits an account once across two overlapping campaigns", async () => {
    // Not per campaign — per account, ever. Two windows that overlap would
    // otherwise both match an account created in the overlap, and nobody plans
    // to pay a welcome gift twice.
    const accountId = await accountCreatedAt(IN_WINDOW);
    const first = await campaign({ amountMinor: 500 });
    const second = await campaign({ amountMinor: 1_000 });

    expect((await wallet.creditCampaign(accountId, first, "b@example.com")).status).toBe(
      "credited",
    );
    expect((await wallet.creditCampaign(accountId, second, "b@example.com")).status).toBe(
      "already_credited",
    );
    expect(await balanceOf(accountId)).toBe(500);
  });

  it("refuses an account created before the window opens", async () => {
    const accountId = await accountCreatedAt(new Date("2026-09-30T23:59:59.000Z"));
    const c = await campaign();

    expect(await wallet.creditCampaign(accountId, c, "b@example.com")).toEqual({
      status: "not_eligible",
      reason: "outside_window",
    });
    expect(await balanceOf(accountId)).toBe(0);
  });

  it("treats the window as half-open, so a boundary signup belongs to one campaign", async () => {
    const onOpening = await accountCreatedAt(OCTOBER_START);
    const onClosing = await accountCreatedAt(OCTOBER_END);
    const c = await campaign();

    expect((await wallet.creditCampaign(onOpening, c, "b@example.com")).status).toBe("credited");
    expect(await wallet.creditCampaign(onClosing, c, "b@example.com")).toEqual({
      status: "not_eligible",
      reason: "outside_window",
    });
  });

  it("refuses an unconfirmed address", async () => {
    // With a campaign live, the address decides £5: one membership per user is
    // enforced, but N addresses give N accounts. See ADR 0188.
    const accountId = await accountCreatedAt(IN_WINDOW);
    const c = await campaign();

    expect(await wallet.creditCampaign(accountId, c, null)).toEqual({
      status: "not_eligible",
      reason: "email_unverified",
    });
    expect(await balanceOf(accountId)).toBe(0);
  });

  it.each(["draft", "paused", "exhausted", "ended"] as const)(
    "credits nobody while the campaign is %s",
    async (status) => {
      const accountId = await accountCreatedAt(IN_WINDOW);
      const c = await campaign({ status });

      expect(await wallet.creditCampaign(accountId, c, "b@example.com")).toEqual({
        status: "not_eligible",
        reason: "campaign_not_live",
      });
      expect(await balanceOf(accountId)).toBe(0);
    },
  );

  it("stops at the budget rather than going one credit past it", async () => {
    const c = await campaign({ amountMinor: 500, budgetMinor: 1_000 });
    // Sequentially: the concurrency under test is the crediting, and three
    // simultaneous sign-ups only exercise supertest's ephemeral server.
    const a = await accountCreatedAt(IN_WINDOW);
    const b = await accountCreatedAt(IN_WINDOW);
    const third = await accountCreatedAt(IN_WINDOW);

    expect((await wallet.creditCampaign(a, c, "a@example.com")).status).toBe("credited");
    expect((await wallet.creditCampaign(b, c, "b@example.com")).status).toBe("credited");
    expect(await wallet.creditCampaign(third, c, "c@example.com")).toEqual({
      status: "budget_exhausted",
    });
    expect(await balanceOf(third)).toBe(0);
  });

  it("lets exactly one of two concurrent credits take the last of the budget", async () => {
    // Two credits against a budget with room for one: exactly one lands, and
    // the campaign never issues more than its budget.
    //
    // **What this does not prove, stated plainly.** It asserts the outcome, not
    // the isolation. Moving the budget read onto a connection outside the
    // serializable snapshot — the exact defect the design guards against — was
    // tried as a mutation and still produced the right answer, as did moving
    // both predicate reads out. Two things absorb it: `runSerializable` retries
    // a serialization failure and the retry reads the committed row, and the
    // one-credit-per-account check does a predicate read over
    // `reference LIKE 'campaign:%'` that conflicts with the other transaction's
    // insert. The checks defend each other, which is good for the platform and
    // inconvenient for a test trying to isolate one of them.
    //
    // The barrier below forces both calls to read the budget before either
    // writes, which is the closest this can get. The isolation itself rests on
    // Serializable and on every deciding read living inside the transaction —
    // ADR 0012's rule for every balance-changing write — not on this test.
    // Recorded rather than papered over, per ADR 0229.
    const c = await campaign({ amountMinor: 500, budgetMinor: 500 });
    const a = await accountCreatedAt(IN_WINDOW);
    const b = await accountCreatedAt(IN_WINDOW);

    let arrived = 0;
    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    // A deadline, so a barrier that only one party ever reaches fails the test
    // rather than hanging the suite.
    const gate = Promise.race([
      bothRead,
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);

    prisma.$use(async (params, next) => {
      const isBudgetRead =
        params.model === "WalletLedgerEntry" &&
        params.action === "aggregate" &&
        typeof (params.args as { where?: { reference?: unknown } })?.where?.reference === "string";
      const result: unknown = await next(params);
      if (isBudgetRead && arrived < 2) {
        arrived += 1;
        if (arrived === 2) release();
        else await gate;
      }
      return result;
    });

    const outcomes = await Promise.all([
      wallet.creditCampaign(a, c, "a@example.com"),
      wallet.creditCampaign(b, c, "b@example.com"),
    ]);

    // Both read the budget before either wrote — otherwise the barrier could
    // not have opened, and this test would be the vacuous one again.
    expect(arrived).toBe(2);
    expect(outcomes.filter((o) => o.status === "credited")).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === "budget_exhausted")).toHaveLength(1);

    const { _sum } = await prisma.walletLedgerEntry.aggregate({
      where: { reference: `campaign:${c.id}` },
      _sum: { amountMinor: true },
    });
    expect(_sum.amountMinor).toBe(500);
  });

  it("leaves a campaign credit spendable like any other balance", async () => {
    // It is not a separate pot: the wallet's balance is the sum of the ledger,
    // and a campaign entry is an entry.
    const accountId = await accountCreatedAt(IN_WINDOW);
    const c = await campaign({ amountMinor: 250 });

    await wallet.creditCampaign(accountId, c, "b@example.com");
    const summary = await wallet.getSummary(accountId);
    expect(summary.balanceMinor).toBe(250);
    expect(summary.currency).toBe("GBP");
  });
});
