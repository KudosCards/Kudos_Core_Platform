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

const importSummarySchema = z.object({
  created: z.number(),
  updated: z.number(),
  rejected: z.array(z.object({ row: z.number(), reason: z.string() })),
});

describe("Recipients (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Signs up a fresh account and returns a bearer token authorised against it. */
  async function signUp(): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID());
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

  it("schedules a birthday event on the calendar the moment a recipient with a DOB is added", async () => {
    const { token } = await signUp();

    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      // A December birthday is well outside the 21-day approval window, so it
      // stays `scheduled` (a calendar marker) rather than being promoted.
      .send({ firstName: "Birthday", lastName: "Child", dateOfBirth: "2015-12-25" })
      .expect(201);

    const occasions = await request(app.getHttpServer())
      .get("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const birthday = (occasions.body.items as { type: string; status: string; occasionDate: string }[]).find(
      (o) => o.type === "birthday",
    );
    expect(birthday).toBeDefined();
    expect(birthday?.status).toBe("scheduled");
    expect(birthday?.occasionDate.slice(5, 10)).toBe("12-25");
  });

  it("does not schedule a birthday for a recipient with no DOB", async () => {
    const { token } = await signUp();
    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "No", lastName: "Birthday" })
      .expect(201);

    const occasions = await request(app.getHttpServer())
      .get("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(occasions.body.items).toHaveLength(0);
  });

  it("schedules birthday events for CSV-imported recipients too", async () => {
    const { token } = await signUp();
    const csv = [
      "firstName,lastName,dateOfBirth,postcode,email",
      "Imported,Pupil,25/12/2016,SW1A 2AA,pupil@example.com",
    ].join("\n");

    await request(app.getHttpServer())
      .post("/recipients/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv), "recipients.csv")
      .expect(201);

    const occasions = await request(app.getHttpServer())
      .get("/occasions?type=birthday")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(occasions.body.items).toHaveLength(1);
    expect(occasions.body.items[0].status).toBe("scheduled");
  });

  it("re-points the scheduled birthday when a recipient's DOB changes", async () => {
    const { token } = await signUp();
    const created = recipientSchema.parse(
      (
        await request(app.getHttpServer())
          .post("/recipients")
          .set("Authorization", `Bearer ${token}`)
          .send({ firstName: "Change", lastName: "OfBirthday", dateOfBirth: "2015-12-25" })
          .expect(201)
      ).body,
    );

    await request(app.getHttpServer())
      .patch(`/recipients/${created.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dateOfBirth: "2015-11-10" })
      .expect(200);

    const occasions = await request(app.getHttpServer())
      .get("/occasions?type=birthday")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const items = occasions.body.items as { status: string; occasionDate: string }[];
    // Exactly one scheduled birthday, now pointing at the new date.
    expect(items).toHaveLength(1);
    expect(items[0]?.occasionDate.slice(5, 10)).toBe("11-10");
  });

  it("accepts page and perPage as query-string params (the web always sends them)", async () => {
    const { token } = await signUp();
    const response = await request(app.getHttpServer())
      .get("/recipients?page=1&perPage=100")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const list = paginatedRecipientsSchema.parse(response.body);
    expect(list.perPage).toBe(100);
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
    // This mutates the *global* free-plan entitlement row (not account-scoped),
    // so any other e2e spec file creating recipients on the free plan while
    // this window is open would see the same cap-of-1 — see the maxWorkers: 1
    // note in jest-e2e.json for why e2e spec files must run serially.
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

  it("does not merge two different recipients that share a name but have no postcode or DOB on file", async () => {
    const { token } = await signUp();

    const csv = [
      "firstName,lastName,dateOfBirth,postcode,email",
      "Jamie,Smith,,,jamie1@example.com",
      "Jamie,Smith,,,jamie2@example.com",
    ].join("\n");

    const importResponse = await request(app.getHttpServer())
      .post("/recipients/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv), "recipients.csv")
      .expect(201);
    const summary = importSummarySchema.parse(importResponse.body);

    // Both rows are new recipients — with no postcode/DOB to distinguish them,
    // they must never be treated as the same person and silently merged.
    expect(summary.created).toBe(2);
    expect(summary.updated).toBe(0);

    const listResponse = await request(app.getHttpServer())
      .get("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const list = paginatedRecipientsSchema.parse(listResponse.body);
    const smiths = list.items.filter((r) => r.lastName === "Smith");
    expect(smiths).toHaveLength(2);
    expect(smiths.map((r) => r.email).sort()).toEqual(["jamie1@example.com", "jamie2@example.com"]);
  });

  it("rejects a structurally malformed CSV with a 400 instead of crashing the whole import", async () => {
    const { token } = await signUp();

    // Second data row has an extra field vs. the header — a mismatched column
    // count, which csv-parse throws on synchronously if not caught.
    const csv = [
      "firstName,lastName,postcode",
      "Good,Row,SW1A 1AA",
      "Bad,Row,SW1A 2AA,extra,columns",
    ].join("\n");

    await request(app.getHttpServer())
      .post("/recipients/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv), "recipients.csv")
      .expect(400);
  });

  it("rejects an import request with no file attached", async () => {
    const { token } = await signUp();
    await request(app.getHttpServer())
      .post("/recipients/import")
      .set("Authorization", `Bearer ${token}`)
      .expect(400);
  });

  it("rejects a malformed email via CSV import that the JSON API would also reject", async () => {
    const { token } = await signUp();
    const csv = ["firstName,lastName,email", "Bad,Email,a@b@example.com"].join("\n");

    const importResponse = await request(app.getHttpServer())
      .post("/recipients/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(csv), "recipients.csv")
      .expect(201);
    const summary = importSummarySchema.parse(importResponse.body);

    expect(summary.created).toBe(0);
    expect(summary.rejected).toHaveLength(1);
    expect(summary.rejected[0]?.reason).toMatch(/not a valid email/);
  });

  it("rejects two concurrent creates that would both push the account over its cap", async () => {
    const { token } = await signUp();
    await prisma.planEntitlement.update({
      where: { planId: "free" },
      data: { recipientCap: 1 },
    });

    try {
      const [first, second] = await Promise.all([
        request(app.getHttpServer())
          .post("/recipients")
          .set("Authorization", `Bearer ${token}`)
          .send({ firstName: "Racer", lastName: "One" }),
        request(app.getHttpServer())
          .post("/recipients")
          .set("Authorization", `Bearer ${token}`)
          .send({ firstName: "Racer", lastName: "Two" }),
      ]);

      const statuses = [first.status, second.status].sort();
      // Exactly one should succeed and one should be rejected for being over
      // cap — never both succeeding, which would silently exceed the plan.
      expect(statuses).toEqual([201, 403]);
    } finally {
      await prisma.planEntitlement.update({
        where: { planId: "free" },
        data: { recipientCap: 50 },
      });
    }
  });
});
