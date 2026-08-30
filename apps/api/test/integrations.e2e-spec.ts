import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema, recipientSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { z } from "zod";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

const paginatedRecipientsSchema = z.object({
  items: z.array(recipientSchema),
  total: z.number(),
  page: z.number(),
  perPage: z.number(),
});

const ingestResultSchema = z.object({
  created: z.number(),
  updated: z.number(),
  skipped: z.number(),
  errors: z.array(z.object({ externalId: z.string(), reason: z.string() })),
});

const apiKeyViewSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  prefix: z.string(),
  lastUsedAt: z.coerce.date().nullable(),
  revokedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});
const createdApiKeySchema = apiKeyViewSchema.extend({ key: z.string() });

describe("Integrations (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
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

  /** Creates an API key for the account and returns its plaintext value. */
  async function createApiKey(token: string, label = "Test key"): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/integrations/api-keys")
      .set("Authorization", `Bearer ${token}`)
      .send({ label })
      .expect(201);
    // The response must never leak the hash.
    expect(response.body).not.toHaveProperty("keyHash");
    const created = createdApiKeySchema.parse(response.body);
    expect(created.key).toMatch(/^kudos_[a-f0-9]{48}$/);
    return created.key;
  }

  function listRecipients(token: string) {
    return request(app.getHttpServer())
      .get("/recipients?perPage=100")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
  }

  it("ingests contacts via a valid API key, tagged source=api", async () => {
    const { token } = await signUp();
    const apiKey = await createApiKey(token);

    const res = await request(app.getHttpServer())
      .post("/integrations/contacts")
      .set("x-api-key", apiKey)
      .send({
        contacts: [
          { externalId: "crm-1", firstName: "Ada", lastName: "Lovelace", email: "ada@example.com" },
          {
            externalId: "crm-2",
            firstName: "Alan",
            lastName: "Turing",
            dateOfBirth: "1912-06-23",
            addressPostcode: "M1 1AA",
          },
        ],
      })
      .expect(201);

    expect(ingestResultSchema.parse(res.body)).toEqual({
      created: 2,
      updated: 0,
      skipped: 0,
      errors: [],
    });

    const list = paginatedRecipientsSchema.parse((await listRecipients(token)).body);
    expect(list.total).toBe(2);
    for (const item of list.items) {
      expect(item.source).toBe("api");
      expect(item.externalId).toMatch(/^crm-/);
    }
    const turing = list.items.find((r) => r.externalId === "crm-2");
    expect(turing?.dateOfBirth).not.toBeNull();
  });

  it("GET /integrations/me returns the account identity for a valid key (Zapier auth test)", async () => {
    const { token, accountId } = await signUp();
    const apiKey = await createApiKey(token);

    const res = await request(app.getHttpServer())
      .get("/integrations/me")
      .set("x-api-key", apiKey)
      .expect(200);

    const identity = z
      .object({
        accountId: z.string().uuid(),
        accountName: z.string(),
        plan: z.string().nullable(),
      })
      .parse(res.body);
    expect(identity.accountId).toBe(accountId);
    expect(identity.accountName).toMatch(/^Test Centre /);
    // Never leaks anything secret.
    expect(JSON.stringify(res.body)).not.toContain("keyHash");
  });

  it("GET /integrations/me rejects a missing or invalid key with 401", async () => {
    await request(app.getHttpServer()).get("/integrations/me").expect(401);
    await request(app.getHttpServer())
      .get("/integrations/me")
      .set("x-api-key", "kudos_notarealkey")
      .expect(401);
  });

  it("re-ingesting the same externalId updates instead of duplicating", async () => {
    const { token } = await signUp();
    const apiKey = await createApiKey(token);

    await request(app.getHttpServer())
      .post("/integrations/contacts")
      .set("x-api-key", apiKey)
      .send({ contacts: [{ externalId: "c-1", firstName: "Grace", lastName: "Hopper" }] })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post("/integrations/contacts")
      .set("x-api-key", apiKey)
      .send({
        contacts: [
          { externalId: "c-1", firstName: "Grace", lastName: "Hopper", email: "grace@navy.mil" },
        ],
      })
      .expect(201);

    expect(second.body).toMatchObject({ created: 0, updated: 1, skipped: 0 });

    const list = paginatedRecipientsSchema.parse((await listRecipients(token)).body);
    expect(list.total).toBe(1);
    expect(list.items[0]?.email).toBe("grace@navy.mil");
  });

  /**
   * The refresh loop writes every column of the dedupe key — first name, last
   * name, postcode, date of birth — so an edit in the source CRM can make one
   * contact collide with another. The create path above it absorbs exactly that
   * with `skipDuplicates`, "instead of a raw P2002 aborting the whole ingest";
   * the update path had no such guard, no transaction and no try/catch, so one
   * collision aborted the loop and every contact behind it was skipped. The
   * nightly sweep then repeated it, identically, for ever. See ADR 0186.
   */
  describe("a contact that collides with another during refresh", () => {
    const POSTCODE = "SW1A 1AA";
    const DOB = "1990-01-01";

    it("keeps going, and still updates the contacts behind the collision", async () => {
      const { token } = await signUp();
      const apiKey = await createApiKey(token);

      // Two distinct people, plus a third to sit behind the collision.
      await request(app.getHttpServer())
        .post("/integrations/contacts")
        .set("x-api-key", apiKey)
        .send({
          contacts: [
            {
              externalId: "a",
              firstName: "Ada",
              lastName: "Lovelace",
              addressPostcode: POSTCODE,
              dateOfBirth: DOB,
            },
            {
              externalId: "b",
              firstName: "Grace",
              lastName: "Hopper",
              addressPostcode: POSTCODE,
              dateOfBirth: DOB,
            },
            {
              externalId: "c",
              firstName: "Katherine",
              lastName: "Johnson",
              addressPostcode: POSTCODE,
              dateOfBirth: DOB,
            },
          ],
        })
        .expect(201);

      // In the CRM, "b" is renamed to the same person as "a" — now their name,
      // postcode and date of birth all match, which is the dedupe key.
      const response = await request(app.getHttpServer())
        .post("/integrations/contacts")
        .set("x-api-key", apiKey)
        .send({
          contacts: [
            {
              externalId: "b",
              firstName: "Ada",
              lastName: "Lovelace",
              addressPostcode: POSTCODE,
              dateOfBirth: DOB,
            },
            {
              externalId: "c",
              firstName: "Katherine",
              lastName: "Johnson",
              addressPostcode: POSTCODE,
              dateOfBirth: DOB,
              email: "katherine@nasa.gov",
            },
          ],
        })
        .expect(201);

      // The collision is reported against the contact that caused it...
      const body = response.body as {
        updated: number;
        skipped: number;
        errors: { externalId: string; reason: string }[];
      };
      expect(body.errors.map((e) => e.externalId)).toContain("b");
      expect(body.errors.find((e) => e.externalId === "b")?.reason).toMatch(
        /match another contact already on file/i,
      );

      // ...and "c", which was queued behind it, was still updated.
      expect(body.updated).toBe(1);
      const list = paginatedRecipientsSchema.parse((await listRecipients(token)).body);
      const katherine = list.items.find((r) => r.firstName === "Katherine");
      expect(katherine?.email).toBe("katherine@nasa.gov");
    });

    it("does not fail the whole sync, so tomorrow night is not a repeat", async () => {
      const { token } = await signUp();
      const apiKey = await createApiKey(token);
      await request(app.getHttpServer())
        .post("/integrations/contacts")
        .set("x-api-key", apiKey)
        .send({
          contacts: [
            {
              externalId: "a",
              firstName: "Ada",
              lastName: "Lovelace",
              addressPostcode: POSTCODE,
              dateOfBirth: DOB,
            },
            {
              externalId: "b",
              firstName: "Grace",
              lastName: "Hopper",
              addressPostcode: POSTCODE,
              dateOfBirth: DOB,
            },
          ],
        })
        .expect(201);

      // A 201 rather than a 500 is the whole point: the caller records
      // lastSyncStatus "ok" with the per-contact problem reported, instead of a
      // raw Prisma constraint string shown to the customer every night.
      await request(app.getHttpServer())
        .post("/integrations/contacts")
        .set("x-api-key", apiKey)
        .send({
          contacts: [
            {
              externalId: "b",
              firstName: "Ada",
              lastName: "Lovelace",
              addressPostcode: POSTCODE,
              dateOfBirth: DOB,
            },
          ],
        })
        .expect(201);

      // The colliding contact keeps the values it had — a refusal, not a
      // partial write.
      const list = paginatedRecipientsSchema.parse((await listRecipients(token)).body);
      expect(list.items.filter((r) => r.firstName === "Grace")).toHaveLength(1);
    });
  });

  it("rejects a missing, invalid, or revoked API key with 401", async () => {
    const { token } = await signUp();
    const apiKey = await createApiKey(token);
    const body = { contacts: [{ externalId: "x", firstName: "A", lastName: "B" }] };

    await request(app.getHttpServer()).post("/integrations/contacts").send(body).expect(401);
    await request(app.getHttpServer())
      .post("/integrations/contacts")
      .set("x-api-key", "kudos_notarealkey")
      .send(body)
      .expect(401);

    // Revoke the real key, then confirm it stops working.
    const keysResponse = await request(app.getHttpServer())
      .get("/integrations/api-keys")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const keys = z.array(apiKeyViewSchema).parse(keysResponse.body);
    await request(app.getHttpServer())
      .delete(`/integrations/api-keys/${keys[0]?.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    await request(app.getHttpServer())
      .post("/integrations/contacts")
      .set("x-api-key", apiKey)
      .send(body)
      .expect(401);
  });

  it("scopes ingest to the key's own account", async () => {
    const a = await signUp();
    const b = await signUp();
    const aKey = await createApiKey(a.token);

    await request(app.getHttpServer())
      .post("/integrations/contacts")
      .set("x-api-key", aKey)
      .send({ contacts: [{ externalId: "only-a", firstName: "Only", lastName: "Ayy" }] })
      .expect(201);

    const aList = paginatedRecipientsSchema.parse((await listRecipients(a.token)).body);
    const bList = paginatedRecipientsSchema.parse((await listRecipients(b.token)).body);
    expect(aList.total).toBe(1);
    expect(bList.total).toBe(0);
  });

  it("validates the payload (empty batch, missing required fields)", async () => {
    const { token } = await signUp();
    const apiKey = await createApiKey(token);

    await request(app.getHttpServer())
      .post("/integrations/contacts")
      .set("x-api-key", apiKey)
      .send({ contacts: [] })
      .expect(400);

    await request(app.getHttpServer())
      .post("/integrations/contacts")
      .set("x-api-key", apiKey)
      .send({ contacts: [{ firstName: "No", lastName: "Id" }] })
      .expect(400);
  });

  it("does not leak keys across accounts and enforces the plan recipient cap", async () => {
    const { token, accountId } = await signUp();
    const apiKey = await createApiKey(token);

    // Free plan caps recipients at 50 (see the seed). Push 51 and confirm one is
    // skipped with a cap reason rather than silently exceeding the plan.
    const contacts = Array.from({ length: 51 }, (_, i) => ({
      externalId: `cap-${i}`,
      firstName: `First${i}`,
      lastName: `Last${i}`,
    }));
    const res = await request(app.getHttpServer())
      .post("/integrations/contacts")
      .set("x-api-key", apiKey)
      .send({ contacts })
      .expect(201);

    const result = ingestResultSchema.parse(res.body);
    expect(result.created).toBe(50);
    expect(result.skipped).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toMatch(/cap/i);

    const count = await prisma.recipient.count({ where: { accountId } });
    expect(count).toBe(50);
  });
});
