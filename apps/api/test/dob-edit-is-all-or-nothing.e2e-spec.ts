import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * Correcting a date of birth writes the contact, re-points their birthday and
 * records who changed what. Those were three separate commits, and the two
 * failure modes below are what that cost. See ADR 0229.
 */
describe("A date-of-birth edit is all or nothing (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  /** Set by a test to make the realign's read throw, standing in for any
   *  failure between the contact write and the audit entry. */
  let failOccasionFindMany = false;
  /** Set by a test to have the next N occasion writes refused by the unique
   *  key, the way another writer taking the corrected date would. */
  let failOccasionUpdates = 0;
  /** Set by a test to make the audit write fail — the last of the three
   *  commits, and the one whose failure used to cost the record itself. */
  let failAuditWrite = false;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);

    prisma.$use(async (params, next) => {
      if (failOccasionFindMany && params.model === "Occasion" && params.action === "findMany") {
        failOccasionFindMany = false;
        throw new Error("connection terminated unexpectedly");
      }
      if (failAuditWrite && params.model === "AuditLogEntry" && params.action === "create") {
        failAuditWrite = false;
        throw new Error("connection terminated unexpectedly");
      }
      if (failOccasionUpdates > 0 && params.model === "Occasion" && params.action === "update") {
        failOccasionUpdates -= 1;
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      const result: unknown = await next(params);
      return result;
    });
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

  async function createContact(token: string, dateOfBirth: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Ada",
        lastName: `Lovelace-${randomUUID().slice(0, 8)}`,
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
        dateOfBirth,
      })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  it("does not commit the new date of birth when the realign fails", async () => {
    // The contact write, the realign and the audit entry were three separate
    // commits. A failure in the middle left a changed date of birth with no
    // AuditLogEntry naming it — on the one table whose whole purpose is to say
    // who touched a child's personal data, and whose own service throws rather
    // than lose a record.
    const { token, accountId } = await signUp();
    const recipientId = await createContact(token, "2015-06-01");

    failOccasionFindMany = true;
    await request(app.getHttpServer())
      .patch(`/recipients/${recipientId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dateOfBirth: "2016-08-09" })
      .expect(500);

    const after = await prisma.recipient.findUniqueOrThrow({ where: { id: recipientId } });
    expect(after.dateOfBirth?.toISOString().slice(0, 10)).toBe("2015-06-01");
    const entries = await prisma.auditLogEntry.findMany({
      where: { accountId, targetId: recipientId, action: "update" },
    });
    expect(entries).toHaveLength(0);
  });

  it("does not commit the new date of birth when the audit write fails", async () => {
    // The one the other test cannot reach. Failing the realign aborts
    // everything before the audit is even attempted, so it passes whether or
    // not the audit shares the transaction. The audit write failing is the
    // actual shape of the finding: the contact write had already committed on
    // its own, so a changed date of birth outlived the record of who changed
    // it — on the table that exists to answer exactly that question.
    const { token, accountId } = await signUp();
    const recipientId = await createContact(token, "2015-06-01");

    failAuditWrite = true;
    await request(app.getHttpServer())
      .patch(`/recipients/${recipientId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dateOfBirth: "2016-08-09" })
      .expect(500);

    const after = await prisma.recipient.findUniqueOrThrow({ where: { id: recipientId } });
    expect(after.dateOfBirth?.toISOString().slice(0, 10)).toBe("2015-06-01");
    const entries = await prisma.auditLogEntry.findMany({
      where: { accountId, targetId: recipientId, action: "update" },
    });
    expect(entries).toHaveLength(0);
  });

  it("records the edit and the realign in one commit", async () => {
    const { token, accountId } = await signUp();
    const recipientId = await createContact(token, "2015-06-01");

    await request(app.getHttpServer())
      .patch(`/recipients/${recipientId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dateOfBirth: "2016-08-09" })
      .expect(200);

    const entries = await prisma.auditLogEntry.findMany({
      where: { accountId, targetId: recipientId, action: "update" },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.metadata).toMatchObject({
      dateOfBirth: { from: "2015-06-01", to: "2016-08-09" },
    });
  });

  it("survives another writer claiming the corrected date first", async () => {
    // The realign checks for a blocker and then moves the keeper onto the
    // corrected date. Between those two statements another request can take the
    // date, and the unique key refuses the write.
    //
    // The refusal is injected rather than raced in by a second writer, and
    // deliberately so: the realign now runs *inside* the request's transaction,
    // so a genuine racing write would need a second connection taken while that
    // transaction holds one and blocks — which deadlocks the pool rather than
    // reproducing anything. What is under test is what the code does when the
    // write is refused, and that is exactly what this produces.
    //
    // It used to be a 500 twice over. The catch that handled it ran further
    // statements on the same `tx`, which Postgres had already marked aborted, so
    // every one failed with 25P02 — the fallback could not once have run.
    const { token, accountId } = await signUp();
    const recipientId = await createContact(token, "2015-06-01");

    failOccasionUpdates = 1;
    await request(app.getHttpServer())
      .patch(`/recipients/${recipientId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dateOfBirth: "2016-08-09" })
      .expect(200);
    expect(failOccasionUpdates).toBe(0);

    // The retry re-ran the whole thing, so the correction landed...
    const after = await prisma.recipient.findUniqueOrThrow({ where: { id: recipientId } });
    expect(after.dateOfBirth?.toISOString().slice(0, 10)).toBe("2016-08-09");
    // ...and exactly once. Two audit entries would mean the first attempt had
    // committed part of its work before the refusal.
    const entries = await prisma.auditLogEntry.findMany({
      where: { accountId, targetId: recipientId, action: "update" },
    });
    expect(entries).toHaveLength(1);
  });

  it("gives up rather than spinning when the date stays taken", async () => {
    // One retry, not a loop. Correcting a date of birth is not a contended
    // operation, so a conflict that survives a fresh read is a bug to surface
    // rather than a queue to wait in.
    //
    // This also holds ADR 0185's invariant, which lost its own `$transaction`
    // when the realign moved inside this one: the realign retires and deletes
    // the losing rows *before* it moves the keeper, so a failure at the move
    // must take the destruction with it. Otherwise a correction that failed
    // has still destroyed the contact's other birthdays, and every retry fails
    // identically with less left each time.
    const { token, accountId } = await signUp();
    const recipientId = await createContact(token, "2015-06-01");
    // A surplus live birthday on another date — one of the rows the realign
    // would discard on its way to moving the keeper.
    const surplus = await prisma.occasion.create({
      data: {
        accountId,
        recipientId,
        type: "birthday",
        source: "recurring_per_recipient",
        occasionDate: new Date(Date.UTC(new Date().getUTCFullYear() + 1, 0, 15)),
        status: "scheduled",
      },
    });

    failOccasionUpdates = 2;
    await request(app.getHttpServer())
      .patch(`/recipients/${recipientId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dateOfBirth: "2016-08-09" })
      .expect(500);
    expect(failOccasionUpdates).toBe(0);

    // The correction is not half-applied...
    const after = await prisma.recipient.findUniqueOrThrow({ where: { id: recipientId } });
    expect(after.dateOfBirth?.toISOString().slice(0, 10)).toBe("2015-06-01");
    // ...and neither is the clearing-out it had started. Which of the two rows
    // the realign picks as the keeper depends on the order they come back in,
    // so assert on both rather than on the one that happens to lose.
    const birthdays = await prisma.occasion.findMany({
      where: { recipientId, type: "birthday" },
      select: { id: true, status: true },
    });
    expect(birthdays).toHaveLength(2);
    expect(birthdays.map((o) => o.status).sort()).toEqual(["scheduled", "scheduled"]);
    expect(birthdays.map((o) => o.id)).toContain(surplus.id);
  });
});
