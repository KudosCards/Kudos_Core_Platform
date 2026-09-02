import { randomUUID } from "node:crypto";
import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import { accountSchema, recipientSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { z } from "zod";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  BREVO_CLIENT,
  type BrevoClient,
  type BrevoContact,
} from "../src/integrations/brevo/brevo-client";
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
  truncated: z.boolean(),
  created: z.number(),
  updated: z.number(),
  skipped: z.number(),
  duplicates: z.number(),
  unmappable: z.number(),
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
/** Set by the truncation test: the Brevo list held more contacts than the
 * paging cap allowed the client to read. */
let brevoTruncated = false;
const brevoMock: BrevoClient = {
  verifyKey: (apiKey) =>
    apiKey.includes("bad")
      ? Promise.reject(new UnauthorizedException("bad key"))
      : Promise.resolve(),
  fetchContacts: () => Promise.resolve({ contacts: mockContacts, truncated: brevoTruncated }),
};

function defaultContacts(): BrevoContact[] {
  return [
    {
      id: 1,
      email: "ada@example.com",
      attributes: { FIRSTNAME: "Ada", LASTNAME: "Lovelace", DOB: "2015-06-01" },
    },
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
    brevoTruncated = false;
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
    expect(connectionViewSchema.parse(res.body)).toMatchObject({
      provider: "brevo",
      syncEnabled: true,
    });

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
      // The third contact has no surname, so the mapper dropped it before
      // ingest ever saw it. It is not "skipped" — nothing skipped it — but it
      // is one of the three the customer was told about, and until it was
      // counted the summary read "2 created, 0 skipped (of 3 fetched)" and
      // left them to work out where the third went.
      unmappable: 1,
      duplicates: 0,
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

  it("a list past the paging cap records a partial sync, not ok", async () => {
    // The Brevo half of the same defect: the contacts that fit still land, but
    // the connection must stop telling the customer the import was complete.
    const { token, accountId } = await signUp();
    await connect(token).expect(201);
    brevoTruncated = true;

    const sync = await request(app.getHttpServer())
      .post("/integrations/connections/brevo/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(syncResultSchema.parse(sync.body).truncated).toBe(true);
    const stored = await prisma.crmConnection.findFirstOrThrow({ where: { accountId } });
    expect(stored.lastSyncStatus).toMatch(/partial/i);
  });

  it("accounts for every contact the provider handed over", async () => {
    // The invariant the summary rests on. Whatever else changes, a contact that
    // was fetched is either created, updated, skipped, a duplicate of another
    // in the same pull, or unmappable — never simply absent.
    const { token } = await signUp();
    await connect(token).expect(201);
    mockContacts = [
      { id: 1, email: "ada@example.com", attributes: { FIRSTNAME: "Ada", LASTNAME: "Lovelace" } },
      // Same externalId twice in one pull — collapsed, last one wins.
      { id: 1, email: "ada2@example.com", attributes: { FIRSTNAME: "Ada", LASTNAME: "Lovelace" } },
      { id: 2, email: "no@example.com", attributes: { FIRSTNAME: "NoLast" } },
      { id: 3, email: "n@example.com", attributes: {} },
    ];

    const sync = await request(app.getHttpServer())
      .post("/integrations/connections/brevo/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    const result = syncResultSchema.parse(sync.body);
    expect(result.fetched).toBe(4);
    expect(result.unmappable).toBe(2);
    expect(result.duplicates).toBe(1);
    expect(result.created).toBe(1);
    expect(
      result.created + result.updated + result.skipped + result.duplicates + result.unmappable,
    ).toBe(result.fetched);
  });

  it("counts a contact refused on update as skipped, with a reason", async () => {
    // An edit in the source CRM can make one contact the same person as
    // another already on file. The update is refused — correctly — but the
    // contact was landing in neither `updated` nor `skipped`, so it left the
    // summary entirely while `errors` named it to nobody.
    const { token } = await signUp();
    // The dedupe key is (account, first, last, postcode, date of birth), and
    // Postgres treats NULLs in a unique index as distinct — so a postcode has
    // to be mapped for two contacts to be capable of colliding at all.
    await request(app.getHttpServer())
      .post("/integrations/connections")
      .set("Authorization", `Bearer ${token}`)
      .send({
        provider: "brevo",
        apiKey: "brevo-key-good",
        fieldMapping: { dateOfBirth: "DOB", addressPostcode: "POSTCODE" },
      })
      .expect(201);
    mockContacts = [
      {
        id: 10,
        email: "grace@example.com",
        attributes: {
          FIRSTNAME: "Grace",
          LASTNAME: "Hopper",
          DOB: "2015-01-01",
          POSTCODE: "SW1A 1AA",
        },
      },
      {
        id: 20,
        email: "alan@example.com",
        attributes: {
          FIRSTNAME: "Alan",
          LASTNAME: "Turing",
          DOB: "2015-02-02",
          POSTCODE: "SW1A 1AA",
        },
      },
    ];
    await request(app.getHttpServer())
      .post("/integrations/connections/brevo/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    // Contact 20 is renamed in the CRM to the person contact 10 already is.
    mockContacts = [
      {
        id: 20,
        email: "alan@example.com",
        attributes: {
          FIRSTNAME: "Grace",
          LASTNAME: "Hopper",
          DOB: "2015-01-01",
          POSTCODE: "SW1A 1AA",
        },
      },
    ];
    const second = await request(app.getHttpServer())
      .post("/integrations/connections/brevo/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    const result = syncResultSchema.parse(second.body);
    expect(result).toMatchObject({ fetched: 1, created: 0, updated: 0, skipped: 1 });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.externalId).toBe("20");
    expect(
      result.created + result.updated + result.skipped + result.duplicates + result.unmappable,
    ).toBe(result.fetched);
  });

  it("does not record a sync that lost contacts as ok", async () => {
    // The connections list renders any non-"ok" status verbatim, and it is the
    // only trace a nightly sync leaves. Writing "ok" over a pull that dropped
    // contacts is how a customer comes to believe their whole address book is
    // here.
    const { token, accountId } = await signUp();
    await connect(token).expect(201);

    await request(app.getHttpServer())
      .post("/integrations/connections/brevo/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    const stored = await prisma.crmConnection.findFirstOrThrow({ where: { accountId } });
    expect(stored.lastSyncStatus).not.toBe("ok");
    expect(stored.lastSyncStatus).toContain("1 of 3");
  });

  it("records ok when every contact came across", async () => {
    const { token, accountId } = await signUp();
    await connect(token).expect(201);
    mockContacts = [
      { id: 1, email: "ada@example.com", attributes: { FIRSTNAME: "Ada", LASTNAME: "Lovelace" } },
    ];

    await request(app.getHttpServer())
      .post("/integrations/connections/brevo/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    const stored = await prisma.crmConnection.findFirstOrThrow({ where: { accountId } });
    expect(stored.lastSyncStatus).toBe("ok");
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
