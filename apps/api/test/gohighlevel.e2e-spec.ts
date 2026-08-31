import { randomUUID } from "node:crypto";
import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import { accountSchema, recipientSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { z } from "zod";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  GOHIGHLEVEL_CLIENT,
  type GoHighLevelClient,
  type GoHighLevelContact,
} from "../src/integrations/gohighlevel/gohighlevel-client";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

// The OAuth flow encrypts a signed state and the stored tokens with
// CREDENTIALS_ENCRYPTION_KEY, and builds the consent URL from the GoHighLevel app
// config. CI has no .env — so provide deterministic test values here, before the
// app boots, keeping the suite self-contained and environment-independent.
process.env.CREDENTIALS_ENCRYPTION_KEY ??= "0".repeat(64);
process.env.GOHIGHLEVEL_CLIENT_ID ??= "test-ghl-client-id";
process.env.GOHIGHLEVEL_CLIENT_SECRET ??= "test-ghl-client-secret";
// Registered under the white-label-safe "leadconnector" slug (GoHighLevel
// rejects a redirect URL containing "gohighlevel"); the controller maps it back.
process.env.GOHIGHLEVEL_REDIRECT_URI ??=
  "https://api.test.example/integrations/oauth/leadconnector/callback";

const LOCATION_ID = "loc-abc-123";

const paginatedRecipientsSchema = z.object({
  items: z.array(recipientSchema),
  total: z.number(),
  page: z.number(),
  perPage: z.number(),
});

const syncResultSchema = z.object({
  fetched: z.number(),
  truncated: z.boolean(),
  created: z.number(),
  updated: z.number(),
  skipped: z.number(),
  errors: z.array(z.object({ externalId: z.string(), reason: z.string() })),
});

const startResultSchema = z.object({ url: z.string().url() });

/** Mutable so a test can change what GoHighLevel "returns" and observe refreshes
 * and the locationId the contacts fetch was scoped to. */
let ghlContacts: GoHighLevelContact[] = [];
/** Set by the truncation test: GoHighLevel had more contacts than the paging
 * cap allowed the client to read. */
let ghlTruncated = false;
let exchangeCalls = 0;
let refreshCalls = 0;
let lastFetchLocationId: string | null = null;

const ghlMock: GoHighLevelClient = {
  exchangeCode: (code) => {
    exchangeCalls += 1;
    if (code === "bad-code") {
      return Promise.reject(new UnauthorizedException("GoHighLevel rejected the authorization"));
    }
    return Promise.resolve({
      accessToken: "ghl-access-1",
      refreshToken: "ghl-refresh-1",
      expiresInSeconds: 86399,
      // An agency-scoped grant carries no single location. GoHighLevel's consent
      // screen offers both, and picking the agency is what a real customer did
      // five times over five weeks. See ADR 0213.
      ...(code === "agency-code" ? {} : { externalAccountId: LOCATION_ID }),
    });
  },
  refreshTokens: () => {
    refreshCalls += 1;
    return Promise.resolve({
      accessToken: "ghl-access-2",
      refreshToken: "ghl-refresh-2",
      expiresInSeconds: 86399,
      externalAccountId: LOCATION_ID,
    });
  },
  fetchContacts: (_accessToken, locationId) => {
    lastFetchLocationId = locationId;
    return Promise.resolve({ contacts: ghlContacts, truncated: ghlTruncated });
  },
};

function defaultGoHighLevelContacts(): GoHighLevelContact[] {
  return [
    {
      id: "201",
      firstName: "Grace",
      lastName: "Hopper",
      email: "grace@example.com",
      dateOfBirth: "2016-12-09T00:00:00.000Z",
      postalCode: "SW1A 1AA",
    },
    { id: "202", firstName: "Katherine", lastName: "Johnson", email: "kj@example.com" },
    // No lastName → not addressable → mapper skips it before ingest.
    { id: "203", firstName: "NoLast" },
  ];
}

describe("CRM connections — GoHighLevel OAuth (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp([{ provide: GOHIGHLEVEL_CLIENT, useValue: ghlMock }]);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    ghlContacts = defaultGoHighLevelContacts();
    ghlTruncated = false;
    exchangeCalls = 0;
    refreshCalls = 0;
    lastFetchLocationId = null;
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

  async function startAndGetState(token: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .get("/integrations/oauth/gohighlevel/start")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const { url } = startResultSchema.parse(res.body);
    const parsed = new URL(url);
    expect(parsed.hostname).toContain("gohighlevel.com");
    expect(parsed.searchParams.get("client_id")).toBe("test-ghl-client-id");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toContain("contacts.readonly");
    const state = parsed.searchParams.get("state");
    expect(state).toBeTruthy();
    return state!;
  }

  async function connectGoHighLevel(token: string): Promise<void> {
    const state = await startAndGetState(token);
    await request(app.getHttpServer())
      .get("/integrations/oauth/leadconnector/callback")
      .query({ code: "good-code", state })
      .expect(302)
      .expect("location", /connected=gohighlevel/);
  }

  it("completes OAuth, storing tokens encrypted and the granted locationId", async () => {
    const { token, accountId } = await signUp();
    await connectGoHighLevel(token);

    expect(exchangeCalls).toBe(1);
    const stored = await prisma.crmConnection.findFirstOrThrow({ where: { accountId } });
    expect(stored.authType).toBe("oauth");
    expect(stored.encryptedApiKey).toBeNull();
    expect(stored.encryptedAccessToken).not.toBeNull();
    expect(stored.encryptedAccessToken).not.toContain("ghl-access-1");
    expect(stored.encryptedAccessToken!.split(":")).toHaveLength(3); // iv:tag:ciphertext
    expect(stored.encryptedRefreshToken).not.toContain("ghl-refresh-1");
    // The locationId the token is scoped to is persisted (needed for every fetch).
    expect(stored.externalAccountId).toBe(LOCATION_ID);

    const list = await request(app.getHttpServer())
      .get("/integrations/connections")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(JSON.stringify(list.body)).not.toContain("ghl-access-1");
    expect(JSON.stringify(list.body)).not.toContain("ghl-refresh-1");
  });

  /**
   * A grant with no location cannot ever sync — GoHighLevel scopes contacts to
   * one. Storing it as a working connection and then telling the customer to
   * "reconnect" sends them round a loop that cannot succeed. See ADR 0213.
   */
  describe("a grant with no location", () => {
    it("is refused at the callback, storing nothing", async () => {
      const { token, accountId } = await signUp();
      const state = await startAndGetState(token);

      await request(app.getHttpServer())
        .get("/integrations/oauth/leadconnector/callback")
        .query({ code: "agency-code", state })
        .expect(302);

      const stored = await prisma.crmConnection.findFirst({ where: { accountId } });
      expect(stored).toBeNull();
    });

    it("sends the customer back with a reason the page can act on", async () => {
      const { token } = await signUp();
      const state = await startAndGetState(token);

      const res = await request(app.getHttpServer())
        .get("/integrations/oauth/leadconnector/callback")
        .query({ code: "agency-code", state })
        .expect(302);

      const location = res.headers.location as string;
      expect(location).toContain("error=gohighlevel");
      // Not just "it failed" — which of the two choices to make next time.
      expect(location).toContain("reason=no_location");
    });

    it("leaves a working connection alone rather than breaking it", async () => {
      // Reconnecting and picking the agency by mistake must not destroy a
      // connection that was already syncing.
      const { token, accountId } = await signUp();
      await connectGoHighLevel(token);
      const before = await prisma.crmConnection.findFirstOrThrow({ where: { accountId } });
      expect(before.externalAccountId).toBe(LOCATION_ID);

      const state = await startAndGetState(token);
      await request(app.getHttpServer())
        .get("/integrations/oauth/leadconnector/callback")
        .query({ code: "agency-code", state })
        .expect(302);

      const after = await prisma.crmConnection.findFirstOrThrow({ where: { accountId } });
      expect(after.externalAccountId).toBe(LOCATION_ID);
      expect(after.encryptedAccessToken).toBe(before.encryptedAccessToken);
    });

    it("tells an already-stored agency connection which choice to make", async () => {
      // Rows stored before the callback started refusing these still exist.
      const { token, accountId } = await signUp();
      await connectGoHighLevel(token);
      await prisma.crmConnection.updateMany({
        where: { accountId, provider: "gohighlevel" },
        data: { externalAccountId: null },
      });

      const res = await request(app.getHttpServer())
        .post("/integrations/connections/gohighlevel/sync")
        .set("Authorization", `Bearer ${token}`)
        .expect(400);

      const message = (res.body as { message: string }).message;
      expect(message).toMatch(/sub-account/i);
      // Not the bare "reconnect it" that sent a customer round five times.
      expect(message).toMatch(/agency/i);
    });

    it("still connects normally when a sub-account is chosen", async () => {
      const { token, accountId } = await signUp();
      await connectGoHighLevel(token);

      const stored = await prisma.crmConnection.findFirstOrThrow({ where: { accountId } });
      expect(stored.externalAccountId).toBe(LOCATION_ID);
    });
  });

  it("rejects a forged/invalid state — no connection is created", async () => {
    const { accountId } = await signUp();
    await request(app.getHttpServer())
      .get("/integrations/oauth/leadconnector/callback")
      .query({ code: "good-code", state: "not-a-real-signed-state" })
      .expect(302)
      .expect("location", /error=gohighlevel/);
    expect(exchangeCalls).toBe(0);
    expect(await prisma.crmConnection.count({ where: { accountId } })).toBe(0);
  });

  it("redirects with an error when GoHighLevel denies (no code)", async () => {
    await request(app.getHttpServer())
      .get("/integrations/oauth/leadconnector/callback")
      .query({ error: "access_denied" })
      .expect(302)
      .expect("location", /error=gohighlevel/);
    expect(exchangeCalls).toBe(0);
  });

  it("syncs contacts as source=gohighlevel, scoped to the granted location", async () => {
    const { token, accountId } = await signUp();
    await connectGoHighLevel(token);

    const res = await request(app.getHttpServer())
      .post("/integrations/connections/gohighlevel/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    const result = syncResultSchema.parse(res.body);
    expect(result.fetched).toBe(3);
    expect(result.created).toBe(2); // 201 + 202; 203 has no last name
    expect(result.skipped).toBe(0);

    // The fetch was scoped to the locationId captured at connect time.
    expect(lastFetchLocationId).toBe(LOCATION_ID);

    const recipients = await prisma.recipient.findMany({ where: { accountId } });
    expect(recipients).toHaveLength(2);
    for (const recipient of recipients) {
      expect(recipient.source).toBe("gohighlevel");
    }
    const grace = recipients.find((r) => r.externalId === "201");
    expect(grace?.addressPostcode).toBe("SW1A 1AA");
    expect(grace?.dateOfBirth).not.toBeNull();

    const listed = await request(app.getHttpServer())
      .get("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const parsed = paginatedRecipientsSchema.parse(listed.body);
    expect(parsed.items.every((item) => item.source === "gohighlevel")).toBe(true);
  });

  it("a location past the paging cap records a partial sync, not ok", async () => {
    // The GoHighLevel half of the same defect: what fits still lands, but the
    // connection must stop telling the customer the import was complete.
    const { token, accountId } = await signUp();
    await connectGoHighLevel(token);
    ghlTruncated = true;

    const res = await request(app.getHttpServer())
      .post("/integrations/connections/gohighlevel/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(syncResultSchema.parse(res.body).truncated).toBe(true);
    const stored = await prisma.crmConnection.findFirstOrThrow({
      where: { accountId, provider: "gohighlevel" },
    });
    expect(stored.lastSyncStatus).toMatch(/partial/i);
  });

  /**
   * Kudos posts physical birthday cards. That needs a date of birth and a postal
   * address, and GoHighLevel makes both optional — so an import can report 500
   * new contacts in green while a dozen of them can actually be sent anything.
   * The sync says how many arrived usable. See ADR 0214.
   */
  it("reports how many imported contacts can actually be sent a card", async () => {
    const { token } = await signUp();
    await connectGoHighLevel(token);
    const address = { address1: "1 Test Street", city: "London", postalCode: "SW1A 1AA" };
    ghlContacts = [
      // Complete — a card can be sent.
      { id: "c1", firstName: "Ada", lastName: "Lovelace", dateOfBirth: "2015-06-01", ...address },
      { id: "c2", firstName: "Alan", lastName: "Turing", dateOfBirth: "2016-03-04", ...address },
      // Has a birthday but nowhere to post to.
      { id: "c3", firstName: "Grace", lastName: "Hopper", dateOfBirth: "2014-12-09" },
      // Postable, but we don't know when to send.
      { id: "c4", firstName: "Katherine", lastName: "Johnson", ...address },
      // Neither.
      { id: "c5", firstName: "Mary", lastName: "Jackson" },
    ];

    const res = await request(app.getHttpServer())
      .post("/integrations/connections/gohighlevel/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    const body = res.body as {
      created: number;
      readiness: {
        total: number;
        withDateOfBirth: number;
        withPostalAddress: number;
        sendable: number;
      };
    };
    expect(body.created).toBe(5);
    expect(body.readiness).toEqual({
      total: 5,
      withDateOfBirth: 3, // c1, c2, c3
      withPostalAddress: 3, // c1, c2, c4
      sendable: 2, // only c1 and c2 can be posted a birthday card
    });
  });

  it("counts only this CRM's contacts, not everyone on the account", async () => {
    // The sentence is about the import that just ran. A customer with hundreds
    // of hand-added contacts would otherwise see a reassuring number that says
    // nothing about what GoHighLevel actually delivered.
    const { token, accountId } = await signUp();
    await connectGoHighLevel(token);
    await prisma.recipient.create({
      data: {
        accountId,
        firstName: "Hand",
        lastName: "Added",
        source: "manual",
        dateOfBirth: new Date(Date.UTC(2015, 0, 1)),
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
      },
    });
    ghlContacts = [{ id: "c1", firstName: "Ada", lastName: "Lovelace" }];

    const res = await request(app.getHttpServer())
      .post("/integrations/connections/gohighlevel/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    const { readiness } = res.body as {
      readiness: { total: number; sendable: number };
    };
    // One GoHighLevel contact, not two — and it is not sendable.
    expect(readiness.total).toBe(1);
    expect(readiness.sendable).toBe(0);
  });

  it("leaves archived contacts out — nothing is being sent to them", async () => {
    const { token, accountId } = await signUp();
    await connectGoHighLevel(token);
    const address = { address1: "1 Test Street", city: "London", postalCode: "SW1A 1AA" };
    ghlContacts = [
      { id: "c1", firstName: "Ada", lastName: "Lovelace", dateOfBirth: "2015-06-01", ...address },
      { id: "c2", firstName: "Alan", lastName: "Turing", dateOfBirth: "2016-03-04", ...address },
    ];
    await request(app.getHttpServer())
      .post("/integrations/connections/gohighlevel/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    // The customer archives one. It stays in GoHighLevel, so it keeps arriving.
    await prisma.recipient.updateMany({
      where: { accountId, externalId: "c2" },
      data: { status: "archived" },
    });

    const res = await request(app.getHttpServer())
      .post("/integrations/connections/gohighlevel/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    const { readiness } = res.body as { readiness: { total: number; sendable: number } };
    expect(readiness.total).toBe(1);
    expect(readiness.sendable).toBe(1);
  });

  it("counts a contact the CRM left blank but the customer completed by hand", async () => {
    // Updates merge rather than clear, so someone already complete in Kudos is
    // still sendable even when GoHighLevel carries nothing for them. Counting
    // the payload instead of the stored state would understate this.
    const { token, accountId } = await signUp();
    await connectGoHighLevel(token);
    ghlContacts = [{ id: "c1", firstName: "Ada", lastName: "Lovelace" }];
    await request(app.getHttpServer())
      .post("/integrations/connections/gohighlevel/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    await prisma.recipient.updateMany({
      where: { accountId, externalId: "c1" },
      data: {
        dateOfBirth: new Date(Date.UTC(2015, 5, 1)),
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
      },
    });

    const res = await request(app.getHttpServer())
      .post("/integrations/connections/gohighlevel/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect((res.body as { readiness: { sendable: number } }).readiness.sendable).toBe(1);
  });

  it("re-syncing the same contacts dedupes instead of duplicating", async () => {
    const { token, accountId } = await signUp();
    await connectGoHighLevel(token);

    await request(app.getHttpServer())
      .post("/integrations/connections/gohighlevel/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post("/integrations/connections/gohighlevel/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    expect(syncResultSchema.parse(second.body)).toMatchObject({ created: 0, updated: 2 });
    expect(await prisma.recipient.count({ where: { accountId } })).toBe(2);
  });

  it("refreshes an expired access token before syncing", async () => {
    const { token, accountId } = await signUp();
    await connectGoHighLevel(token);

    await prisma.crmConnection.updateMany({
      where: { accountId, provider: "gohighlevel" },
      data: { tokenExpiresAt: new Date(Date.now() - 60_000) },
    });

    await request(app.getHttpServer())
      .post("/integrations/connections/gohighlevel/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(refreshCalls).toBe(1);
    const refreshed = await prisma.crmConnection.findFirstOrThrow({
      where: { accountId, provider: "gohighlevel" },
    });
    expect(refreshed.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(refreshed.encryptedAccessToken).not.toContain("ghl-access-2");
  });

  it("scopes connections per account (one account can't sync another's)", async () => {
    const a = await signUp();
    const b = await signUp();
    await connectGoHighLevel(a.token);

    await request(app.getHttpServer())
      .post("/integrations/connections/gohighlevel/sync")
      .set("Authorization", `Bearer ${b.token}`)
      .expect(404);

    const list = await request(app.getHttpServer())
      .get("/integrations/connections")
      .set("Authorization", `Bearer ${b.token}`)
      .expect(200);
    expect(list.body).toEqual([]);
  });
});
