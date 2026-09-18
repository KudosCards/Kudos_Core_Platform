import { randomUUID } from "node:crypto";
import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import { BIRTHDAY_PLACEHOLDER_YEAR, accountSchema, recipientSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { z } from "zod";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  CLEANCLOUD_CLIENT,
  type CleanCloudClient,
  type CleanCloudCustomer,
} from "../src/integrations/cleancloud/cleancloud-client";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

// Same reason as the Brevo suite: CryptoService needs a key at connect time and
// CI has no .env.
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
  readiness: z.object({
    total: z.number(),
    withDateOfBirth: z.number(),
    withPostalAddress: z.number(),
    sendable: z.number(),
  }),
});

let mockCustomers: CleanCloudCustomer[] = [];
let cleanCloudTruncated = false;
const cleanCloudMock: CleanCloudClient = {
  verifyKey: (apiToken) =>
    apiToken.includes("bad")
      ? Promise.reject(new UnauthorizedException("CleanCloud rejected the API token"))
      : Promise.resolve(),
  fetchCustomers: () =>
    Promise.resolve({ contacts: mockCustomers, truncated: cleanCloudTruncated }),
};

function defaultCustomers(): CleanCloudCustomer[] {
  return [
    {
      customerID: "1001",
      customerName: "Ada Lovelace",
      customerAddress: "12 Acacia Avenue, Camden, London, NW1 8AB",
      customerEmail: "ada@example.com",
      birthdayDay: "10",
      birthdayMonth: "12",
    },
    {
      // No postcode in the free-text address: imports, but is not postable —
      // and the readiness counts are what say so.
      customerID: "1002",
      customerName: "Alan Turing",
      customerAddress: "Somewhere in Manchester",
      customerEmail: "alan@example.com",
      birthdayDay: 23,
      birthdayMonth: 6,
    },
    // A mononym. Nobody to address a card to, so the mapper drops it and the
    // summary counts it as unmappable rather than losing it silently.
    { customerID: "1003", customerName: "Yusuf", customerAddress: "1 High St, Leeds, LS1 4AP" },
  ];
}

describe("CRM connections — CleanCloud (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp([{ provide: CLEANCLOUD_CLIENT, useValue: cleanCloudMock }]);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockCustomers = defaultCustomers();
    cleanCloudTruncated = false;
  });

  async function signUp(): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID());
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Test Cleaners ${randomUUID()}` })
      .expect(201);
    return { token, accountId: accountSchema.parse(response.body).id };
  }

  function connect(token: string, apiKey = "cleancloud-token-good") {
    return request(app.getHttpServer())
      .post("/integrations/connections")
      .set("Authorization", `Bearer ${token}`)
      .send({ provider: "cleancloud", apiKey });
  }

  function sync(token: string) {
    return request(app.getHttpServer())
      .post("/integrations/connections/cleancloud/sync")
      .set("Authorization", `Bearer ${token}`);
  }

  function listContacts(token: string) {
    return request(app.getHttpServer())
      .get("/recipients?perPage=100")
      .set("Authorization", `Bearer ${token}`);
  }

  it("connects with the CleanCloud token, storing it encrypted", async () => {
    const { token, accountId } = await signUp();

    await connect(token).expect(201);

    const stored = await prisma.crmConnection.findFirstOrThrow({ where: { accountId } });
    expect(stored.provider).toBe("cleancloud");
    expect(stored.authType).toBe("api_key");
    expect(stored.encryptedApiKey).not.toContain("cleancloud-token-good");
    // Fixed fields: nothing to configure, so nothing is stored.
    expect(stored.fieldMapping).toBeNull();
  });

  it("checks the token against CleanCloud, not against whichever client is first", async () => {
    // The connect path used to verify every api_key provider against Brevo.
    // With one api_key provider that was invisible; with two it would reject
    // every valid CleanCloud token.
    const { token } = await signUp();
    await connect(token, "bad-token").expect(401);
  });

  it("refuses a field mapping, rather than storing one nothing reads", async () => {
    const { token } = await signUp();

    const res = await request(app.getHttpServer())
      .post("/integrations/connections")
      .set("Authorization", `Bearer ${token}`)
      .send({
        provider: "cleancloud",
        apiKey: "cleancloud-token-good",
        fieldMapping: { dateOfBirth: "DOB" },
      })
      .expect(400);

    expect(JSON.stringify(res.body)).toMatch(/nothing to map/i);
  });

  it("imports customers, parsing the single address field into postable columns", async () => {
    const { token } = await signUp();
    await connect(token).expect(201);

    const result = syncResultSchema.parse((await sync(token).expect(201)).body);
    expect(result).toMatchObject({ fetched: 3, created: 2, unmappable: 1 });
    // Two imported; only the one with a postcode can actually be posted to.
    expect(result.readiness).toMatchObject({ total: 2, withPostalAddress: 1, sendable: 1 });

    const list = paginatedRecipientsSchema.parse((await listContacts(token).expect(200)).body);
    const ada = list.items.find((r) => r.firstName === "Ada");
    expect(ada).toMatchObject({
      source: "cleancloud",
      externalId: "1001",
      lastName: "Lovelace",
      addressLine1: "12 Acacia Avenue",
      addressLine2: "Camden",
      addressCity: "London",
      addressPostcode: "NW1 8AB",
    });
  });

  it("marks an imported birthday as having no year, and still schedules it", async () => {
    const { token, accountId } = await signUp();
    await connect(token).expect(201);
    await sync(token).expect(201);

    const list = paginatedRecipientsSchema.parse((await listContacts(token).expect(200)).body);
    const ada = list.items.find((r) => r.firstName === "Ada");
    expect(ada?.birthYearKnown).toBe(false);
    expect(ada?.dateOfBirth?.getUTCFullYear()).toBe(BIRTHDAY_PLACEHOLDER_YEAR);
    expect(ada?.dateOfBirth?.getUTCMonth()).toBe(11);
    expect(ada?.dateOfBirth?.getUTCDate()).toBe(10);

    // The year is a placeholder; the birthday is real, and lands on the
    // calendar like any other.
    const occasions = await prisma.occasion.findMany({
      where: { accountId, type: "birthday" },
      select: { occasionDate: true },
    });
    expect(occasions.length).toBeGreaterThan(0);
    expect(occasions.some((o) => o.occasionDate.getUTCDate() === 10)).toBe(true);
  });

  it("does not stamp out a birth year somebody typed in by hand", async () => {
    // The nightly re-walk hands back the same yearless birthday every night.
    // Without the guard in birthdayUpdate it would overwrite the real year for
    // ever, and the customer would watch their correction disappear daily.
    const { token } = await signUp();
    await connect(token).expect(201);
    await sync(token).expect(201);

    const before = paginatedRecipientsSchema.parse((await listContacts(token).expect(200)).body);
    const ada = before.items.find((r) => r.firstName === "Ada")!;

    await request(app.getHttpServer())
      .patch(`/recipients/${ada.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dateOfBirth: "1985-12-10" })
      .expect(200);

    await sync(token).expect(201);

    const after = paginatedRecipientsSchema.parse((await listContacts(token).expect(200)).body);
    const corrected = after.items.find((r) => r.id === ada.id);
    expect(corrected?.birthYearKnown).toBe(true);
    expect(corrected?.dateOfBirth?.getUTCFullYear()).toBe(1985);
  });

  it("still corrects the day and month a yearless source changes", async () => {
    // The source is authoritative about WHICH DAY; it just never claimed to
    // know the year. A moved birthday must still move.
    const { token } = await signUp();
    await connect(token).expect(201);
    await sync(token).expect(201);

    mockCustomers = [{ ...defaultCustomers()[0]!, birthdayDay: "11", birthdayMonth: "12" }];
    await sync(token).expect(201);

    const list = paginatedRecipientsSchema.parse((await listContacts(token).expect(200)).body);
    const ada = list.items.find((r) => r.firstName === "Ada");
    expect(ada?.dateOfBirth?.getUTCDate()).toBe(11);
    expect(ada?.birthYearKnown).toBe(false);
  });

  it("re-syncs onto the same contacts rather than duplicating them", async () => {
    const { token } = await signUp();
    await connect(token).expect(201);
    await sync(token).expect(201);

    const second = syncResultSchema.parse((await sync(token).expect(201)).body);

    expect(second).toMatchObject({ created: 0, updated: 2 });
    const list = paginatedRecipientsSchema.parse((await listContacts(token).expect(200)).body);
    expect(list.total).toBe(2);
  });

  it("records a history that stopped short as partial, not ok", async () => {
    const { token, accountId } = await signUp();
    await connect(token).expect(201);
    cleanCloudTruncated = true;

    const result = syncResultSchema.parse((await sync(token).expect(201)).body);

    expect(result.truncated).toBe(true);
    const stored = await prisma.crmConnection.findFirstOrThrow({ where: { accountId } });
    expect(stored.lastSyncStatus).toMatch(/partial/i);
  });
});
