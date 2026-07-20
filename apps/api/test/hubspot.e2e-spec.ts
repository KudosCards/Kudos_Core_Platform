import { randomUUID } from "node:crypto";
import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import { accountSchema, recipientSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { z } from "zod";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  HUBSPOT_CLIENT,
  type HubSpotClient,
  type HubSpotContact,
} from "../src/integrations/hubspot/hubspot-client";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

// The OAuth flow encrypts a signed state and the stored tokens with
// CREDENTIALS_ENCRYPTION_KEY, and builds the consent URL from the HubSpot app
// config. Local dev reads these from .env; CI has none — so provide
// deterministic test values here, before the app boots, keeping the suite
// self-contained and environment-independent.
process.env.CREDENTIALS_ENCRYPTION_KEY ??= "0".repeat(64);
process.env.HUBSPOT_CLIENT_ID ??= "test-hubspot-client-id";
process.env.HUBSPOT_CLIENT_SECRET ??= "test-hubspot-client-secret";
process.env.HUBSPOT_REDIRECT_URI ??= "https://api.test.example/integrations/oauth/hubspot/callback";

const paginatedRecipientsSchema = z.object({
  items: z.array(recipientSchema),
  total: z.number(),
  page: z.number(),
  perPage: z.number(),
});

const syncResultSchema = z.object({
  fetched: z.number(),
  created: z.number(),
  updated: z.number(),
  skipped: z.number(),
  errors: z.array(z.object({ externalId: z.string(), reason: z.string() })),
});

const startResultSchema = z.object({ url: z.string().url() });

/** Mutable so a test can change what HubSpot "returns" and observe refreshes. */
let hubspotContacts: HubSpotContact[] = [];
let exchangeCalls = 0;
let refreshCalls = 0;

const hubspotMock: HubSpotClient = {
  exchangeCode: (code) => {
    exchangeCalls += 1;
    if (code === "bad-code") {
      return Promise.reject(new UnauthorizedException("HubSpot rejected the authorization"));
    }
    return Promise.resolve({
      accessToken: "access-token-1",
      refreshToken: "refresh-token-1",
      expiresInSeconds: 1800,
    });
  },
  refreshTokens: () => {
    refreshCalls += 1;
    return Promise.resolve({
      accessToken: "access-token-2",
      refreshToken: "refresh-token-2",
      expiresInSeconds: 1800,
    });
  },
  fetchContacts: () => Promise.resolve(hubspotContacts),
};

function defaultHubSpotContacts(): HubSpotContact[] {
  return [
    {
      id: "101",
      properties: {
        firstname: "Grace",
        lastname: "Hopper",
        email: "grace@example.com",
        date_of_birth: "2016-12-09",
        zip: "SW1A 1AA",
      },
    },
    { id: "102", properties: { firstname: "Katherine", lastname: "Johnson", email: "kj@example.com" } },
    // No lastname → not addressable → mapper skips it before ingest.
    { id: "103", properties: { firstname: "NoLast" } },
  ];
}

describe("CRM connections — HubSpot OAuth (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp([{ provide: HUBSPOT_CLIENT, useValue: hubspotMock }]);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    hubspotContacts = defaultHubSpotContacts();
    exchangeCalls = 0;
    refreshCalls = 0;
  });

  async function signUp(): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID());
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Test Centre ${randomUUID()}` })
      .expect(201);
    return { token, accountId: accountSchema.parse(response.body).id };
  }

  /** Runs the authenticated "start" step and returns the signed state the
   * consent URL carries — what a real HubSpot redirect would echo back. */
  async function startAndGetState(token: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .get("/integrations/oauth/hubspot/start")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const { url } = startResultSchema.parse(res.body);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("client_id")).toBe("test-hubspot-client-id");
    expect(parsed.searchParams.get("scope")).toContain("crm.objects.contacts.read");
    const state = parsed.searchParams.get("state");
    expect(state).toBeTruthy();
    return state!;
  }

  /** Completes the OAuth handshake for an account, leaving it connected. */
  async function connectHubSpot(token: string): Promise<void> {
    const state = await startAndGetState(token);
    await request(app.getHttpServer())
      .get("/integrations/oauth/hubspot/callback")
      .query({ code: "good-code", state })
      .expect(302)
      .expect("location", /connected=hubspot/);
  }

  it("completes OAuth and stores tokens encrypted — never in plaintext", async () => {
    const { token, accountId } = await signUp();
    await connectHubSpot(token);

    expect(exchangeCalls).toBe(1);
    const stored = await prisma.crmConnection.findFirstOrThrow({ where: { accountId } });
    expect(stored.authType).toBe("oauth");
    expect(stored.encryptedApiKey).toBeNull();
    expect(stored.encryptedAccessToken).not.toBeNull();
    expect(stored.encryptedAccessToken).not.toContain("access-token-1");
    expect(stored.encryptedAccessToken!.split(":")).toHaveLength(3); // iv:tag:ciphertext
    expect(stored.encryptedRefreshToken).not.toContain("refresh-token-1");
    expect(stored.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());

    // The connection list never leaks a token.
    const list = await request(app.getHttpServer())
      .get("/integrations/connections")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(JSON.stringify(list.body)).not.toContain("access-token-1");
    expect(JSON.stringify(list.body)).not.toContain("refresh-token-1");
  });

  it("rejects a forged/invalid state — no connection is created", async () => {
    const { accountId } = await signUp();

    await request(app.getHttpServer())
      .get("/integrations/oauth/hubspot/callback")
      .query({ code: "good-code", state: "not-a-real-signed-state" })
      .expect(302)
      .expect("location", /error=hubspot/);

    expect(exchangeCalls).toBe(0);
    const count = await prisma.crmConnection.count({ where: { accountId } });
    expect(count).toBe(0);
  });

  it("redirects with an error when HubSpot denies (no code)", async () => {
    await request(app.getHttpServer())
      .get("/integrations/oauth/hubspot/callback")
      .query({ error: "access_denied" })
      .expect(302)
      .expect("location", /error=hubspot/);
    expect(exchangeCalls).toBe(0);
  });

  it("syncs contacts as source=hubspot, skipping unaddressable ones", async () => {
    const { token, accountId } = await signUp();
    await connectHubSpot(token);

    const res = await request(app.getHttpServer())
      .post("/integrations/connections/hubspot/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    const result = syncResultSchema.parse(res.body);
    expect(result.fetched).toBe(3);
    expect(result.created).toBe(2); // 101 + 102; 103 has no last name
    expect(result.skipped).toBe(0);

    const recipients = await prisma.recipient.findMany({ where: { accountId } });
    expect(recipients).toHaveLength(2);
    for (const recipient of recipients) {
      expect(recipient.source).toBe("hubspot");
    }
    const grace = recipients.find((r) => r.externalId === "101");
    expect(grace?.addressPostcode).toBe("SW1A 1AA");
    expect(grace?.dateOfBirth).not.toBeNull();

    // A read of the recipients API confirms the source is visible to the app.
    const listed = await request(app.getHttpServer())
      .get("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const parsed = paginatedRecipientsSchema.parse(listed.body);
    expect(parsed.items.every((item) => item.source === "hubspot")).toBe(true);
  });

  it("re-syncing the same contacts dedupes instead of duplicating", async () => {
    const { token, accountId } = await signUp();
    await connectHubSpot(token);

    await request(app.getHttpServer())
      .post("/integrations/connections/hubspot/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post("/integrations/connections/hubspot/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    const result = syncResultSchema.parse(second.body);
    expect(result.created).toBe(0);
    expect(result.updated).toBe(2);

    const count = await prisma.recipient.count({ where: { accountId } });
    expect(count).toBe(2);
  });

  it("refreshes an expired access token before syncing", async () => {
    const { token, accountId } = await signUp();
    await connectHubSpot(token);

    // Force the stored access token to look expired.
    await prisma.crmConnection.updateMany({
      where: { accountId, provider: "hubspot" },
      data: { tokenExpiresAt: new Date(Date.now() - 60_000) },
    });

    await request(app.getHttpServer())
      .post("/integrations/connections/hubspot/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(refreshCalls).toBe(1);
    const refreshed = await prisma.crmConnection.findFirstOrThrow({
      where: { accountId, provider: "hubspot" },
    });
    expect(refreshed.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(refreshed.encryptedAccessToken).not.toContain("access-token-2");
  });

  it("scopes connections per account (one account can't sync another's)", async () => {
    const a = await signUp();
    const b = await signUp();
    await connectHubSpot(a.token);

    // Account B has no HubSpot connection.
    await request(app.getHttpServer())
      .post("/integrations/connections/hubspot/sync")
      .set("Authorization", `Bearer ${b.token}`)
      .expect(404);

    // And B's connection list is empty.
    const list = await request(app.getHttpServer())
      .get("/integrations/connections")
      .set("Authorization", `Bearer ${b.token}`)
      .expect(200);
    expect(list.body).toEqual([]);
  });
});
