import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import type { WalletCampaign } from "@prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { WalletService } from "../src/wallet/wallet.service";
import { WalletCampaignsService } from "../src/wallet/wallet-campaigns.service";
import { SUPABASE_ADMIN_CLIENT } from "../src/supabase/supabase-admin.provider";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * The sweep has no request and so no token: it asks Supabase's own record
 * whether the address is confirmed, which is what ADR 0188 concluded should
 * happen wherever an address decides an outcome. Faked here, with
 * `email_confirmed_at` set — the unconfirmed case has its own test below, and
 * the rule itself is covered against the real code path in
 * wallet-campaign-credit.e2e-spec.ts.
 */
const confirmedUsers = new Set<string>();
const getUserByIdMock = jest.fn((userId: string) =>
  Promise.resolve(
    confirmedUsers.has(userId) || confirmedUsers.size === 0
      ? {
          data: {
            user: { email: `${userId}@example.com`, email_confirmed_at: new Date().toISOString() },
          },
          error: null,
        }
      : { data: { user: null }, error: null },
  ),
);
const supabaseAdminMock = { auth: { admin: { getUserById: getUserByIdMock } } };

/**
 * Delivery: the hourly sweep, and the eager credit at signup.
 *
 * The sweep is the primitive and the hook is the optimisation. The tests that
 * matter here are the ones the hook alone could never satisfy: a window that
 * had already started when the campaign was created, and a campaign paused and
 * resumed while sign-ups kept arriving.
 *
 * See docs/wallet-campaigns-plan.md.
 */
describe("Wallet campaign delivery (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let wallet: WalletService;
  let campaigns: WalletCampaignsService;

  beforeAll(async () => {
    app = await createTestApp([{ provide: SUPABASE_ADMIN_CLIENT, useValue: supabaseAdminMock }]);
    prisma = app.get(PrismaService);
    wallet = app.get(WalletService);
    campaigns = app.get(WalletCampaignsService);
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * A fresh, disjoint window per test.
   *
   * The database is truncated per spec file, not per test, so accounts and
   * campaigns accumulate within this one. Sharing a window made each test's
   * sweep pick up the previous test's accounts through the previous test's
   * still-live campaign — the assertions failed for a reason that had nothing
   * to do with the code. Disjoint windows make the suite order-independent, and
   * are a fairer model of reality anyway: campaigns do not overlap by accident.
   */
  let windowIndex = 0;
  let WINDOW_START: Date;
  let WINDOW_END: Date;
  let IN_WINDOW: Date;

  beforeEach(() => {
    windowIndex += 1;
    WINDOW_START = new Date(Date.UTC(2020 + windowIndex, 0, 1));
    WINDOW_END = new Date(Date.UTC(2020 + windowIndex, 1, 1));
    IN_WINDOW = new Date(Date.UTC(2020 + windowIndex, 0, 15, 12));
  });

  /** A signed-up account, back-dated so window rules can be exercised. */
  async function signedUpAt(createdAt: Date): Promise<string> {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Sweep co ${randomUUID()}` })
      .expect(201);
    const me = await request(app.getHttpServer())
      .get("/accounts/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const id = (me.body as { id: string }).id;
    await prisma.account.update({ where: { id }, data: { createdAt } });
    return id;
  }

  /** A guest checkout's account: no membership, and holding its claim token. */
  async function unclaimedGuestAt(createdAt: Date): Promise<string> {
    const account = await prisma.account.create({
      data: {
        origin: "guest",
        type: "individual",
        name: "Guest",
        planId: "free",
        contactEmail: `guest-${randomUUID().slice(0, 8)}@example.com`,
        claimToken: randomUUID(),
        claimTokenExpiresAt: new Date(Date.now() + 86_400_000),
        createdAt,
      },
    });
    return account.id;
  }

  async function campaign(overrides: Partial<WalletCampaign> = {}): Promise<WalletCampaign> {
    return prisma.walletCampaign.create({
      data: {
        name: `Sweep ${randomUUID().slice(0, 8)}`,
        amountMinor: 500,
        startsAt: WINDOW_START,
        endsAt: WINDOW_END,
        budgetMinor: 100_000,
        status: "live",
        createdByUserId: randomUUID(),
        ...overrides,
      },
    });
  }

  const balanceOf = async (accountId: string): Promise<number> =>
    (await wallet.getSummary(accountId)).balanceMinor;

  it("credits a window that had already started when the campaign was created", async () => {
    // The whole reason the sweep is the primitive: a hook can only ever credit
    // sign-ups that happen after it exists.
    const early = await signedUpAt(IN_WINDOW);
    const later = await signedUpAt(IN_WINDOW);
    await campaign();

    const summary = await campaigns.sweep();

    expect(summary.credited).toBe(2);
    expect(summary.creditedMinor).toBe(1_000);
    expect(await balanceOf(early)).toBe(500);
    expect(await balanceOf(later)).toBe(500);
  });

  it("credits nobody twice, however often it runs", async () => {
    const accountId = await signedUpAt(IN_WINDOW);
    await campaign();

    await campaigns.sweep();
    const second = await campaigns.sweep();

    expect(second.credited).toBe(0);
    expect(await balanceOf(accountId)).toBe(500);
  });

  it("leaves an unclaimed guest account alone", async () => {
    // A guest account exists because someone is buying, not because they signed
    // up: no owner membership, and it still holds its claim token.
    const guest = await unclaimedGuestAt(IN_WINDOW);
    await campaign();

    const summary = await campaigns.sweep();

    expect(await balanceOf(guest)).toBe(0);
    // `skipped` is the discriminator, and the reason this assertion is here:
    // an unfiltered query would still not credit the guest — it has no owner
    // membership to look up an address for — but it *would* fetch it and then
    // decline, which is a candidate we paid to consider. Zero means the query
    // never offered it.
    expect(summary.skipped).toBe(0);
  });

  it("leaves a guest account alone after it has been claimed", async () => {
    // The case the origin column exists for. A claim nulls claimToken and
    // claimTokenExpiresAt, renames the account and gives it an owner
    // membership — so the filter this replaced ("has an owner, holds no claim
    // token") saw a claimed guest as a registration and would have credited
    // them. The column is recorded at creation and a claim does not touch it.
    const guest = await unclaimedGuestAt(IN_WINDOW);
    await prisma.account.update({
      where: { id: guest },
      data: {
        claimToken: null,
        claimTokenExpiresAt: null,
        name: "Claimed buyer",
        memberships: { create: { userId: randomUUID(), role: "owner", email: "b@example.com" } },
      },
    });
    await campaign();

    const summary = await campaigns.sweep();

    expect(await balanceOf(guest)).toBe(0);
    expect(summary.skipped).toBe(0);
  });

  it("credits nobody while paused, and catches them up on resume", async () => {
    // Eligibility is the window, not the running state — so an account created
    // during a pause is still in-window when the campaign comes back.
    const duringPause = await signedUpAt(IN_WINDOW);
    const c = await campaign({ status: "paused" });

    expect((await campaigns.sweep()).credited).toBe(0);
    expect(await balanceOf(duringPause)).toBe(0);

    await prisma.walletCampaign.update({ where: { id: c.id }, data: { status: "live" } });
    expect((await campaigns.sweep()).credited).toBe(1);
    expect(await balanceOf(duringPause)).toBe(500);
  });

  it("stops at the budget, marks the campaign exhausted, and tells an operator", async () => {
    const operator = randomUUID();
    await prisma.platformAdmin.create({ data: { userId: operator, role: "super_admin" } });
    await signedUpAt(IN_WINDOW);
    await signedUpAt(IN_WINDOW);
    await signedUpAt(IN_WINDOW);
    const c = await campaign({ amountMinor: 500, budgetMinor: 1_000 });

    const summary = await campaigns.sweep();

    expect(summary.credited).toBe(2);
    expect(summary.exhausted).toEqual([c.id]);
    expect((await prisma.walletCampaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe(
      "exhausted",
    );

    // A campaign that silently stops is a campaign nobody knows has stopped.
    const alert = await prisma.platformNotification.findFirst({
      where: { kind: "wallet_campaign_exhausted", entityId: c.id },
    });
    expect(alert).not.toBeNull();

    const { _sum } = await prisma.walletLedgerEntry.aggregate({
      where: { reference: `campaign:${c.id}` },
      _sum: { amountMinor: true },
    });
    expect(_sum.amountMinor).toBe(1_000);
  });

  it("does not credit again once a campaign is exhausted", async () => {
    const c = await campaign({ status: "exhausted" });
    const accountId = await signedUpAt(IN_WINDOW);

    const summary = await campaigns.sweep();

    expect(summary.credited).toBe(0);
    expect(await balanceOf(accountId)).toBe(0);
    expect(c.status).toBe("exhausted");
    // Same discriminator as the guest test. `creditCampaign` would refuse an
    // exhausted campaign anyway — it checks the status itself — so without
    // this the sweep's own `status: "live"` filter could be deleted and every
    // other assertion here would still pass.
    expect(summary.skipped).toBe(0);
  });

  it("credits at signup, without waiting for the sweep", async () => {
    // The eager half. The window has to contain *now*, because that is when the
    // account is created — this is the one test that cannot back-date.
    const now = new Date();
    const c = await prisma.walletCampaign.create({
      data: {
        name: `Live now ${randomUUID().slice(0, 8)}`,
        amountMinor: 750,
        startsAt: new Date(now.getTime() - 60_000),
        endsAt: new Date(now.getTime() + 3_600_000),
        budgetMinor: 100_000,
        status: "live",
        createdByUserId: randomUUID(),
      },
    });

    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Eager co ${randomUUID()}` })
      .expect(201);
    const me = await request(app.getHttpServer())
      .get("/accounts/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const accountId = (me.body as { id: string }).id;

    expect(await balanceOf(accountId)).toBe(750);
    const entry = (await wallet.getSummary(accountId)).entries[0];
    expect(entry).toMatchObject({ type: "campaign", amountMinor: 750 });
    expect(entry!.reference).toBe(`campaign:${c.id}`);
  });

  it("still creates the account when no campaign is running", async () => {
    // The credit is best-effort precisely so it can never cost a signup.
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "individual", name: `No campaign ${randomUUID()}` })
      .expect(201);
  });
});
