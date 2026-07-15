import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema, recipientSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { z } from "zod";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/mint-token";

const paginatedRecipientsSchema = z.object({
  items: z.array(recipientSchema),
  total: z.number(),
  page: z.number(),
  perPage: z.number(),
});

const importSummarySchema = z.object({
  created: z.number(),
  updated: z.number(),
  rejected: z.array(z.object({ row: z.number(), reason: z.string() })),
});

describe("Recipients (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const secret = process.env.SUPABASE_JWT_SECRET ?? "";

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Signs up a fresh account and returns a bearer token authorised against it. */
  async function signUp(): Promise<{ token: string; accountId: string }> {
    const token = mintToken(secret, randomUUID());
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Test Centre ${randomUUID()}` })
      .expect(201);
    return { token, accountId: accountSchema.parse(response.body).id };
  }

  it("creates a recipient and lists it back", async () => {
    const { token } = await signUp();

    const createResponse = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Archie", lastName: "Winn", addressPostcode: "SW1A 1AA" })
      .expect(201);
    const created = recipientSchema.parse(createResponse.body);

    expect(created).toMatchObject({
      firstName: "Archie",
      lastName: "Winn",
      status: "active",
    });

    const listResponse = await request(app.getHttpServer())
      .get("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const list = paginatedRecipientsSchema.parse(listResponse.body);

    expect(list.total).toBe(1);
    expect(list.items[0]?.id).toBe(created.id);
  });

  it("rejects a duplicate recipient (same name + postcode + DOB)", async () => {
    const { token } = await signUp();
    const payload = {
      firstName: "Sophia",
      lastName: "Johnstone",
      dateOfBirth: "2020-05-14",
      addressPostcode: "SW1A 2AA",
    };

    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send(payload)
      .expect(201);

    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send(payload)
      .expect(409);
  });

  it("rejects an invalid postcode", async () => {
    const { token } = await signUp();
    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Bad", lastName: "Postcode", addressPostcode: "NOTAPOSTCODE" })
      .expect(400);
  });

  it("scopes recipients to the account — one account cannot see another's data", async () => {
    const accountA = await signUp();
    const accountB = await signUp();

    const createResponse = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${accountA.token}`)
      .send({ firstName: "Private", lastName: "ToAccountA" })
      .expect(201);
    const created = recipientSchema.parse(createResponse.body);

    await request(app.getHttpServer())
      .get(`/recipients/${created.id}`)
      .set("Authorization", `Bearer ${accountB.token}`)
      .expect(404);

    const listForB = await request(app.getHttpServer())
      .get("/recipients")
      .set("Authorization", `Bearer ${accountB.token}`)
      .expect(200);
    expect(paginatedRecipientsSchema.parse(listForB.body).total).toBe(0);
  });

  it("archives a recipient", async () => {
    const { token } = await signUp();
    const createResponse = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "To", lastName: "Archive" })
      .expect(201);
    const created = recipientSchema.parse(createResponse.body);

    const archiveResponse = await request(app.getHttpServer())
      .delete(`/recipients/${created.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(recipientSchema.parse(archiveResponse.body).status).toBe("archived");
  });

  it("enforces the plan's recipient cap", async () => {
    const { token, accountId } = await signUp();
    await prisma.planEntitlement.update({
      where: { planId: "free" },
      data: { recipientCap: 1 },
    });

    try {
      await request(app.getHttpServer())
        .post("/recipients")
        .set("Authorization", `Bearer ${token}`)
        .send({ firstName: "First", lastName: "Recipient" })
        .expect(201);

      await request(app.getHttpServer())
        .post("/recipients")
        .set("Authorization", `Bearer ${token}`)
        .send({ firstName: "Second", lastName: "Recipient" })
        .expect(403);
    } finally {
      await prisma.planEntitlement.update({
        where: { planId: "free" },
        data: { recipientCap: 50 },
      });
    }

    const count = await prisma.recipient.count({ where: { accountId } });
    expect(count).toBe(1);
  });

  it("imports a CSV: creates new rows, updates existing ones, and reports rejected rows", async () => {
    const { token } = await signUp();

    // Pre-existing recipient that the CSV should update, not duplicate.
    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Archie",
        lastName: "Winn",
        dateOfBirth: "2011-05-29",
        addressPostcode: "SW1A 1AA",
      })
      .expect(201);

    const csv = [
      "firstName,lastName,dateOfBirth,postcode,email",
      "Sophia,Johnstone,14/05/2020,SW1A 2AA,sophia@example.com",
      "BadRow,Missing,not-a-date,SW1A 4AA,",
      "Archie,Winn,29/05/2011,SW1A 1AA,updated@example.com",
    ].join("\n");

    const importResponse = await request(app.getHttpServer())
      .post("/recipients/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv), "recipients.csv")
      .expect(201);
    const summary = importSummarySchema.parse(importResponse.body);

    expect(summary.created).toBe(1);
    expect(summary.updated).toBe(1);
    expect(summary.rejected).toHaveLength(1);
    expect(summary.rejected[0]?.reason).toMatch(/dd\/mm\/yyyy/);

    const listResponse = await request(app.getHttpServer())
      .get("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const list = paginatedRecipientsSchema.parse(listResponse.body);
    expect(list.total).toBe(2);

    const archie = list.items.find((r) => r.lastName === "Winn");
    expect(archie?.email).toBe("updated@example.com");
  });
});
