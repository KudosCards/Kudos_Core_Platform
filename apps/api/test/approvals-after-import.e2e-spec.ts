import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * Adding contacts fills Approvals straight away.
 *
 * Reported by a customer who imported two thousand contacts: the calendar was
 * full of upcoming birthdays and Approvals read "Nothing waiting for approval
 * right now". Both screens were telling the truth — a contact's birthday is
 * created `scheduled`, and only the 06:00 scheduler promoted it to
 * `pending_approval`. The calendar shows both statuses as "upcoming"; Approvals
 * filters on `pending_approval`. So the two disagreed for up to a day, with
 * nothing on either screen to explain it.
 *
 * The promotion rule now runs wherever occasions are eagerly created, scoped to
 * that account. See promote-due-occasions.util.ts.
 */
describe("Approvals after adding contacts (e2e)", () => {
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
      .send({ type: "organisation", name: `Import Co ${randomUUID()}` })
      .expect(201);
    return { token, accountId: (response.body as { id: string }).id };
  }

  /** A date of birth whose next occurrence is `inDays` from now. */
  function dobDueIn(inDays: number): string {
    const due = new Date();
    due.setUTCHours(0, 0, 0, 0);
    due.setUTCDate(due.getUTCDate() + inDays);
    return new Date(Date.UTC(1990, due.getUTCMonth(), due.getUTCDate())).toISOString().slice(0, 10);
  }

  function pendingApproval(token: string) {
    return request(app.getHttpServer())
      .get("/occasions?status=pending_approval&perPage=50")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
  }

  it("puts a contact added with an imminent birthday straight into Approvals", async () => {
    const { token } = await signUp();

    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Imminent",
        lastName: "Birthday",
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
        // Well inside the 21-day approval window.
        dateOfBirth: dobDueIn(5),
      })
      .expect(201);

    const response = await pendingApproval(token);
    expect((response.body as { total: number }).total).toBe(1);
  });

  it("leaves a far-off birthday out of Approvals, on the calendar only", async () => {
    // The other half of the rule, and the reason occasions are not simply
    // created `pending_approval`: a birthday ten months out belongs on the
    // calendar, not in a queue asking someone to act on it.
    const { token } = await signUp();

    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Distant",
        lastName: "Birthday",
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
        dateOfBirth: dobDueIn(200),
      })
      .expect(201);

    expect((await pendingApproval(token)).body).toMatchObject({ total: 0 });
    // …but it is on the calendar.
    const calendar = await request(app.getHttpServer())
      .get("/occasions?status=scheduled&perPage=50")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect((calendar.body as { total: number }).total).toBe(1);
  });

  it("fills Approvals from a CSV import, not just a single add", async () => {
    // The reported path. A mixed import: some birthdays inside the window, some
    // far off — only the imminent ones should be waiting for approval.
    const { token } = await signUp();
    const rows = [
      "firstName,lastName,addressLine1,addressCity,addressPostcode,dateOfBirth",
      `Soon,One,1 Test Street,London,SW1A 1AA,${dobDueIn(3)}`,
      `Soon,Two,2 Test Street,London,SW1A 1AA,${dobDueIn(10)}`,
      `Soon,Three,3 Test Street,London,SW1A 1AA,${dobDueIn(20)}`,
      `Later,One,4 Test Street,London,SW1A 1AA,${dobDueIn(120)}`,
      `Later,Two,5 Test Street,London,SW1A 1AA,${dobDueIn(240)}`,
    ].join("\n");

    await request(app.getHttpServer())
      .post("/recipients/import")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", Buffer.from(rows), { filename: "contacts.csv", contentType: "text/csv" })
      .expect(201);

    const response = await pendingApproval(token);
    expect((response.body as { total: number }).total).toBe(3);
  });

  it("promotes a birthday that a corrected date of birth moves into the window", async () => {
    const { token } = await signUp();
    const created = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Corrected",
        lastName: "Birthday",
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
        dateOfBirth: dobDueIn(200),
      })
      .expect(201);
    expect((await pendingApproval(token)).body).toMatchObject({ total: 0 });

    await request(app.getHttpServer())
      .patch(`/recipients/${(created.body as { id: string }).id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dateOfBirth: dobDueIn(7) })
      .expect(200);

    expect((await pendingApproval(token)).body).toMatchObject({ total: 1 });
  });

  it("does not put an archived contact's birthday in the queue", async () => {
    // Same guard the nightly sweep has: an archived contact's events stay out of
    // the account-wide views.
    const { token, accountId } = await signUp();
    const created = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Archived",
        lastName: "Contact",
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
        dateOfBirth: dobDueIn(400),
      })
      .expect(201);
    const recipientId = (created.body as { id: string }).id;
    await prisma.recipient.update({
      where: { id: recipientId },
      data: { status: "archived" },
    });
    // Move the occasion into the window behind the archive, so only the
    // recipient's status can keep it out of the queue.
    await prisma.occasion.updateMany({
      where: { accountId, recipientId },
      data: { occasionDate: new Date(Date.now() + 3 * 86_400_000), status: "scheduled" },
    });

    // Any add on this account re-runs the rule.
    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Another",
        lastName: "Contact",
        addressLine1: "9 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
      })
      .expect(201);

    const stranded = await prisma.occasion.findFirst({ where: { accountId, recipientId } });
    expect(stranded?.status).toBe("scheduled");
  });
});
