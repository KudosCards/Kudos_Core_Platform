import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * Running the recurring scheduler by hand.
 *
 * #356 made adding contacts fill Approvals immediately, but it only fires on a
 * write. An account already sitting in the broken state — two thousand contacts
 * imported the day before, a full calendar and an empty Approvals page — stays
 * that way until someone touches a contact or 06:00 comes round. This is the
 * repair: the same platform-wide job the cron runs, on demand.
 */
describe("Admin — run the occasion scheduler (e2e)", () => {
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

  function run(token: string) {
    return request(app.getHttpServer())
      .post("/admin/occasions/scheduler/run")
      .set("Authorization", `Bearer ${token}`);
  }

  /** An account with `count` contacts whose birthdays are `inDays` away, and
   * their occasions left `scheduled` — the state a pre-#356 import produced. */
  async function strandedAccount(count: number, inDays: number): Promise<string> {
    const created = await prisma.account.create({
      data: { type: "organisation", name: `Stranded co ${randomUUID()}`, planId: "centre" },
    });
    const due = new Date();
    due.setUTCHours(0, 0, 0, 0);
    due.setUTCDate(due.getUTCDate() + inDays);

    for (let i = 0; i < count; i++) {
      const recipient = await prisma.recipient.create({
        data: {
          accountId: created.id,
          firstName: "Stranded",
          lastName: `Contact ${i}`,
          addressLine1: "1 Test Street",
          addressCity: "London",
          addressPostcode: "SW1A 1AA",
          status: "active",
          dateOfBirth: new Date(Date.UTC(1990, due.getUTCMonth(), due.getUTCDate())),
        },
      });
      await prisma.occasion.updateMany({
        where: { accountId: created.id, recipientId: recipient.id },
        data: { status: "scheduled" },
      });
    }
    return created.id;
  }

  function pendingCount(accountId: string): Promise<number> {
    return prisma.occasion.count({ where: { accountId, status: "pending_approval" } });
  }

  it("promotes an account that was left stranded, and reports what it did", async () => {
    const token = await adminToken();
    const accountId = await strandedAccount(3, 5);
    expect(await pendingCount(accountId)).toBe(0);

    const response = await run(token).expect(201);
    const body = response.body as { recipients: number; keyDates: number; promoted: number };

    expect(await pendingCount(accountId)).toBe(3);
    // The summary reports the run, not just a bare count: an operator triggering
    // this wants to see it did something.
    expect(body.promoted).toBeGreaterThanOrEqual(3);
    expect(body.recipients).toBeGreaterThanOrEqual(3);
    expect(typeof body.keyDates).toBe("number");
  });

  it("is safe to run twice — the second run promotes nothing new", async () => {
    // The whole point of triggering it by hand is that an operator can, without
    // having to reason about whether they already did. Both halves converge:
    // the creates are skipDuplicates, and the promotion's WHERE stops matching
    // a row once it has moved.
    const token = await adminToken();
    const accountId = await strandedAccount(2, 4);

    await run(token).expect(201);
    const after = await pendingCount(accountId);
    const second = await run(token).expect(201);

    expect(await pendingCount(accountId)).toBe(after);
    expect((second.body as { promoted: number }).promoted).toBe(0);
  });

  it("leaves a far-off birthday alone", async () => {
    // It brings 06:00 forward; it does not widen the window. A birthday months
    // out belongs on the calendar, not in a queue asking someone to act on it.
    const token = await adminToken();
    const accountId = await strandedAccount(2, 200);

    await run(token).expect(201);

    expect(await pendingCount(accountId)).toBe(0);
    expect(
      await prisma.occasion.count({ where: { accountId, status: "scheduled" } }),
    ).toBeGreaterThanOrEqual(2);
  });

  it("refuses an operator who isn't a super admin", async () => {
    // It touches every tenant, so it sits behind the same gate as the other
    // platform-wide repairs.
    const token = await adminToken("ops");
    await run(token).expect(403);
  });

  it("refuses a signed-in customer", async () => {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Nosy co ${randomUUID()}` })
      .expect(201);
    await run(token).expect(403);
  });
});
