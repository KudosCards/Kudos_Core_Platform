import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { EMAIL_CLIENT } from "../src/email/email.client";
import { RemindersService } from "../src/reminders/reminders.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

describe("Reminders (e2e)", () => {
  let app: INestApplication<App>;
  let reminders: RemindersService;
  let sendTransactional: jest.Mock;

  beforeAll(async () => {
    sendTransactional = jest.fn().mockResolvedValue(undefined);
    app = await createTestApp([
      { provide: EMAIL_CLIENT, useValue: { sendTransactional } },
    ]);
    reminders = app.get(RemindersService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    sendTransactional.mockClear();
  });

  /** How many reminder emails were sent to a given address this run. */
  function countEmailsTo(address: string): number {
    const calls = sendTransactional.mock.calls as Array<[{ to: string }]>;
    return calls.filter((call) => call[0]?.to === address).length;
  }

  /** A dd/mm date string a few days from now, so its birthday occasion falls in
   * the reminder window whatever day the suite runs. */
  function birthdayInDays(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `2000-${mm}-${dd}`;
  }

  /** Sign up an account whose contactEmail is a known unique address. */
  async function signUp(email: string): Promise<string> {
    const token = await mintToken(randomUUID(), email);
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "individual", name: "Reminder Test" })
      .expect(201);
    return token;
  }

  async function addRecipientWithBirthday(token: string, daysAhead: number): Promise<void> {
    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Birthday", lastName: "Soon", dateOfBirth: birthdayInDays(daysAhead) })
      .expect(201);
  }

  it("emails an opted-in account about an upcoming birthday, once", async () => {
    const email = `reminders-${randomUUID()}@example.com`;
    const token = await signUp(email);
    await addRecipientWithBirthday(token, 3);

    const result = await reminders.runDueReminders();
    expect(result.accountsEmailed).toBeGreaterThanOrEqual(1);

    // Our account's email was sent exactly one digest.
    expect(countEmailsTo(email)).toBe(1);

    // Its occasion is now marked reminded, so a second run doesn't email again.
    sendTransactional.mockClear();
    await reminders.runDueReminders();
    expect(countEmailsTo(email)).toBe(0);
  });

  it("skips an account that opted out of reminder emails", async () => {
    const email = `optout-${randomUUID()}@example.com`;
    const token = await signUp(email);
    await request(app.getHttpServer())
      .patch("/accounts/me/notifications")
      .set("Authorization", `Bearer ${token}`)
      .send({ reminderEmailsEnabled: false })
      .expect(200);
    await addRecipientWithBirthday(token, 4);

    await reminders.runDueReminders();
    expect(countEmailsTo(email)).toBe(0);
  });

  it("does not remind about a birthday outside the 7-day window", async () => {
    const email = `far-${randomUUID()}@example.com`;
    const token = await signUp(email);
    await addRecipientWithBirthday(token, 30);

    await reminders.runDueReminders();
    expect(countEmailsTo(email)).toBe(0);
  });
});
