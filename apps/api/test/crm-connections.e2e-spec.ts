import { randomUUID } from "node:crypto";
import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import { accountSchema, recipientSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { z } from "zod";
import { PrismaService } from "../src/prisma/prisma.service";
import { BREVO_CLIENT, type BrevoClient, type BrevoContact } from "../src/integrations/brevo/brevo-client";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

// CryptoService reads CREDENTIALS_ENCRYPTION_KEY at connect time to encrypt the
// stored API key. Local dev picks it up from the gitignored .env, but CI has no
// .env — so provide a deterministic 32-byte test key here, before the app boots,
// making this suite self-contained and independent of the environment.
process.env.CREDENTIALS_ENCRYPTION_KEY ??= "0".repeat(64);

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

const connectionViewSchema = z.object({
  provider: z.string(),
  syncEnabled: z.boolean(),
  lastSyncedAt: z.coerce.date().nullable(),
  lastSyncStatus: z.string().nullable(),
  createdAt: z.coerce.date(),
});

/** Mutable so a test can change what Brevo "returns" for the re-sync case. */
let mockContacts: BrevoContact[] = [];
const brevoMock: BrevoClient = {
  verifyKey: (apiKey) =>
    apiKey.includes("bad") ? Promise.reject(new UnauthorizedException("bad key")) : Promise.resolve(),
  fetchContacts: () => Promise.resolve(mockContacts),
};

function defaultContacts(): BrevoContact[] {
  return [
    { id: 1, email: "ada@example.com", attributes: { FIRSTNAME: "Ada", LASTNAME: "Lovelace", DOB: "2015-06-01" } },
    { id: 2, email: "alan@example.com", attributes: { FIRSTNAME: "Alan", LASTNAME: "Turing" } },
    // No LASTNAME → not addressable → mapper skips it before ingest.
    { id: 3, email: "x@example.com", attributes: { FIRSTNAME: "NoLast" } },
  ];
}

describe("CRM connections — Brevo (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp([{ provide: BREVO_CLIENT, useValue: brevoMock }]);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockContacts = defaultContacts();
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

  function connect(token: string, apiKey = "brevo-key-good") {
    return request(app.getHttpServer())
      .post("/integrations/connections")
      .set("Authorization", `Bearer ${token}`)
      .send({ provider: "brevo", apiKey, fieldMapping: { dateOfBirth: "DOB" } });
  }

  it("connects (verifying the key), storing it encrypted — never in plaintext", async () => {
    const { token, accountId } = await signUp();

    const res = await connect(token).expect(201);
    expect(connectionViewSchema.parse(res.body)).toMatchObject({ provider: "brevo", syncEnabled: true });

    const stored = await prisma.crmConnection.findFirstOrThrow({ where: { accountId } });
    expect(stored.authType).toBe("api_key");
    expect(stored.encryptedApiKey).not.toBeNull();
    expect(stored.encryptedApiKey).not.toContain("brevo-key-good");
    expect(stored.encryptedApiKey!.split(":")).toHaveLength(3); // iv:tag:ciphertext

    // The connection list never leaks the key.
    const list = await request(app.getHttpServer())
      .get("/integrations/connections")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(JSON.stringify(list.body)).not.toContain("brevo-key-good");
  });

  it("rejects a bad key at connect time", async () => {
    const { token } = await signUp();
    await connect(token, "bad-key").expect(401);
  });

  it("syncs Brevo contacts into recipients as source=brevo (skipping unaddressable ones)", async () => {
    const { token } = await signUp();
    await connect(token).expect(201);

    const sync = await request(app.getHttpServer())
      .post("/integrations/connections/brevo/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    expect(syncResultSchema.parse(sync.body)).toMatchObject({
      fetched: 3,
      created: 2,
      updated: 0,
      skipped: 0,
    });

    const list = paginatedRecipientsSchema.parse(
      (
        await request(app.getHttpServer())
          .get("/recipients?perPage=100")
          .set("Authorization", `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    expect(list.total).toBe(2);
    for (const item of list.items) {
      expect(item.source).toBe("brevo");
    }
    const ada = list.items.find((r) => r.firstName === "Ada");
    expect(ada?.externalId).toBe("1");
    expect(ada?.dateOfBirth).not.toBeNull();
  });

  it("re-syncing updates matched contacts instead of duplicating", async () => {
    const { token } = await signUp();
    await connect(token).expect(201);
    await request(app.getHttpServer())
      .post("/integrations/connections/brevo/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    // Brevo now reports a new email for Ada.
    mockContacts = [
      { id: 1, email: "ada@navy.mil", attributes: { FIRSTNAME: "Ada", LASTNAME: "Lovelace" } },
    ];
    const second = await request(app.getHttpServer())
      .post("/integrations/connections/brevo/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    expect(second.body).toMatchObject({ fetched: 1, created: 0, updated: 1 });

    const list = paginatedRecipientsSchema.parse(
      (
        await request(app.getHttpServer())
          .get("/recipients?perPage=100")
          .set("Authorization", `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    expect(list.total).toBe(2); // still 2 — Ada updated, Alan untouched
    expect(list.items.find((r) => r.firstName === "Ada")?.email).toBe("ada@navy.mil");
  });

  it("scopes connections to the account and disconnects cleanly", async () => {
    const a = await signUp();
    const b = await signUp();
    await connect(a.token).expect(201);

    // b has no brevo connection → syncing it is a 404, not a's data.
    await request(app.getHttpServer())
      .post("/integrations/connections/brevo/sync")
      .set("Authorization", `Bearer ${b.token}`)
      .expect(404);

    await request(app.getHttpServer())
      .delete("/integrations/connections/brevo")
      .set("Authorization", `Bearer ${a.token}`)
      .expect(204);

    const list = await request(app.getHttpServer())
      .get("/integrations/connections")
      .set("Authorization", `Bearer ${a.token}`)
      .expect(200);
    expect(list.body).toEqual([]);
  });
});
