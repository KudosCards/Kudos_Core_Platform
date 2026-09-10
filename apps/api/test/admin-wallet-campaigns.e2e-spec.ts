import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * The super-admin surface for marketing wallet campaigns.
 *
 * A campaign gives money to every new customer in a window, so the tests worth
 * writing are about who may set one up, what the routes refuse, and whether the
 * readout matches the ledger. The crediting itself is
 * wallet-campaign-credit.e2e-spec's job.
 */
describe("Admin — wallet campaigns (e2e)", () => {
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

  const base = "/admin/wallet-campaigns";

  function post(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(base)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  }

  function put(token: string, path: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .put(`${base}${path}`)
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  }

  function draft(overrides: Record<string, unknown> = {}) {
    return {
      name: `Campaign ${randomUUID().slice(0, 8)}`,
      amountMinor: 500,
      startsOn: "2026-10-01",
      endsOn: "2026-10-31",
      budgetMinor: 100_000,
      ...overrides,
    };
  }

  interface CampaignBody {
    id: string;
    name: string;
    status: string;
    startsOn: string;
    endsOn: string;
    amountMinor: number;
    budgetMinor: number;
    creditedCount: number;
    creditedMinor: number;
  }

  async function create(token: string, overrides: Record<string, unknown> = {}) {
    const response = await post(token, draft(overrides)).expect(201);
    return response.body as CampaignBody;
  }

  it("creates a campaign as a draft, so nothing pays out until someone says so", async () => {
    const token = await adminToken();

    const campaign = await create(token, { name: "October welcome" });

    expect(campaign.status).toBe("draft");
    expect(campaign.startsOn).toBe("2026-10-01");
    expect(campaign.endsOn).toBe("2026-10-31");
    expect(campaign.creditedCount).toBe(0);

    // Stored as instants, and October 2026 starts in BST — so the window opens
    // at 23:00 the night before, not at midnight UTC.
    const stored = await prisma.walletCampaign.findUniqueOrThrow({ where: { id: campaign.id } });
    expect(stored.startsAt.toISOString()).toBe("2026-09-30T23:00:00.000Z");
    expect(stored.endsAt.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(stored.createdByUserId).toBeTruthy();
  });

  it("lets an ops operator look but not touch", async () => {
    const superAdmin = await adminToken();
    const ops = await adminToken("ops");
    const campaign = await create(superAdmin);

    await request(app.getHttpServer()).get(base).set("Authorization", `Bearer ${ops}`).expect(200);

    await post(ops, draft()).expect(403);
    await put(ops, `/${campaign.id}`, { name: "Renamed by ops" }).expect(403);
    await put(ops, `/${campaign.id}/status`, { status: "live" }).expect(403);
  });

  it("refuses an amount or a budget outside the bounds", async () => {
    const token = await adminToken();
    await post(token, draft({ amountMinor: 50 })).expect(400);
    await post(token, draft({ amountMinor: 5_001 })).expect(400);
    await post(token, draft({ budgetMinor: 0 })).expect(400);
    await post(token, draft({ startsOn: "01/10/2026" })).expect(400);
    await post(token, draft({ startsOn: "2026-10-31", endsOn: "2026-10-01" })).expect(400);
  });

  it("moves through the states an operator actually uses", async () => {
    const token = await adminToken();
    const campaign = await create(token);

    for (const status of ["live", "paused", "live", "ended"]) {
      const response = await put(token, `/${campaign.id}/status`, { status }).expect(200);
      expect((response.body as CampaignBody).status).toBe(status);
    }
    // Ended is terminal — the offer cannot start being made again.
    await put(token, `/${campaign.id}/status`, { status: "live" }).expect(409);
  });

  it("will not take `exhausted` as an instruction — only spending the budget does that", async () => {
    const token = await adminToken();
    const campaign = await create(token);
    await put(token, `/${campaign.id}/status`, { status: "exhausted" }).expect(400);
  });

  it("freezes the offer once the campaign is live, but not its name or budget", async () => {
    const token = await adminToken();
    const campaign = await create(token);
    await put(token, `/${campaign.id}/status`, { status: "live" }).expect(200);

    await put(token, `/${campaign.id}`, { amountMinor: 1_000 }).expect(409);
    await put(token, `/${campaign.id}`, { endsOn: "2026-11-30" }).expect(409);

    const updated = await put(token, `/${campaign.id}`, {
      name: "October welcome, extended budget",
      budgetMinor: 250_000,
    }).expect(200);
    expect((updated.body as CampaignBody).name).toBe("October welcome, extended budget");
    expect((updated.body as CampaignBody).budgetMinor).toBe(250_000);
    // The window is untouched by an edit that didn't mention it.
    expect((updated.body as CampaignBody).endsOn).toBe("2026-10-31");
  });

  it("reports what a campaign has paid out, read from the ledger", async () => {
    const token = await adminToken();
    const campaign = await create(token);
    const account = await prisma.account.create({
      data: { origin: "signup", type: "individual", name: `Credited ${randomUUID()}` },
    });
    await prisma.walletLedgerEntry.create({
      data: {
        accountId: account.id,
        type: "campaign",
        amountMinor: 500,
        balanceAfterMinor: 500,
        reference: `campaign:${campaign.id}`,
      },
    });

    const response = await request(app.getHttpServer())
      .get(base)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const listed = (response.body as { campaigns: CampaignBody[] }).campaigns.find(
      (row) => row.id === campaign.id,
    );
    expect(listed?.creditedCount).toBe(1);
    expect(listed?.creditedMinor).toBe(500);

    // And the same money shows up on the overview as the contra figure, because
    // revenue counts an order however it was paid.
    const overview = await request(app.getHttpServer())
      .get("/admin/overview")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(
      (overview.body as { campaignCreditIssuedMinor: number }).campaignCreditIssuedMinor,
    ).toBeGreaterThanOrEqual(500);
  });

  it("refuses a budget below what has already been paid out", async () => {
    const token = await adminToken();
    const campaign = await create(token);
    const account = await prisma.account.create({
      data: { origin: "signup", type: "individual", name: `Credited ${randomUUID()}` },
    });
    await prisma.walletLedgerEntry.create({
      data: {
        accountId: account.id,
        type: "campaign",
        amountMinor: 2_000,
        balanceAfterMinor: 2_000,
        reference: `campaign:${campaign.id}`,
      },
    });

    await put(token, `/${campaign.id}`, { budgetMinor: 1_000 }).expect(400);
    await put(token, `/${campaign.id}`, { budgetMinor: 2_000 }).expect(200);
  });

  it("404s on a campaign that isn't there, rather than inventing one", async () => {
    const token = await adminToken();
    await put(token, `/${randomUUID()}`, { name: "Ghost" }).expect(404);
    await put(token, `/${randomUUID()}/status`, { status: "live" }).expect(404);
  });
});
