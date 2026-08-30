import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { EMAIL_CLIENT } from "../src/email/email.client";
import { PrismaService } from "../src/prisma/prisma.service";
import { RemindersService } from "../src/reminders/reminders.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

describe("Reminders (e2e)", () => {
  let app: INestApplication<App>;
  let reminders: RemindersService;
  let prisma: PrismaService;
  let sendTransactional: jest.Mock;

  beforeAll(async () => {
    sendTransactional = jest.fn().mockResolvedValue(undefined);
    app = await createTestApp([{ provide: EMAIL_CLIENT, useValue: { sendTransactional } }]);
    reminders = app.get(RemindersService);
    prisma = app.get(PrismaService);
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
      .send({
        firstName: "Birthday",
        lastName: "Soon",
        dateOfBirth: birthdayInDays(daysAhead),
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
      })
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

    // The digest is rendered through the shared branded shell: brand footer,
    // brand accent, and the recipient's name in the body.
    const digest = (sendTransactional.mock.calls as Array<[{ to: string; html: string }]>).find(
      (call) => call[0]?.to === email,
    );
    expect(digest?.[0]?.html).toContain("Kudos Cards");
    expect(digest?.[0]?.html).toContain("#e5372a");
    expect(digest?.[0]?.html).toContain("Birthday Soon");

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

  it("does not remind while the posting deadline is still far off", async () => {
    const email = `far-${randomUUID()}@example.com`;
    const token = await signUp(email);
    await addRecipientWithBirthday(token, 30);

    await reminders.runDueReminders();
    expect(countEmailsTo(email)).toBe(0);
  });

  /**
   * The reminder exists to reach a customer while they can still act. What they
   * have to beat is the *posting* deadline, not the occasion date — and the two
   * are not a fixed distance apart: five working days back across a bank holiday
   * or the Christmas rush stretches to eight, eleven, twelve calendar days.
   * Windowing on the occasion date therefore sent the warning after the card had
   * to be in the post. Measured before the fix, first-class:
   *
   *   occasion 2026-05-28 (Thu)  must post 20 May  reminder 21 May  1 day late
   *   occasion 2026-04-10 (Fri)  must post  1 Apr  reminder  3 Apr  2 days late
   *   occasion 2026-12-31 (Thu)  must post 17 Dec  reminder 24 Dec  7 days late
   *
   * Even the ordinary weekday case had zero slack: the reminder landed on the
   * deadline itself. See ADR 0183.
   */
  describe("windowing on the posting deadline", () => {
    /** Force an occasion's dispatch date, modelling a schedule compressed by
     * bank holidays or the December rush without making the test calendar-dependent. */
    async function setDispatchDate(email: string, daysAhead: number): Promise<void> {
      const account = await prisma.account.findFirstOrThrow({ where: { contactEmail: email } });
      const dispatchDate = new Date();
      dispatchDate.setUTCHours(0, 0, 0, 0);
      dispatchDate.setUTCDate(dispatchDate.getUTCDate() + daysAhead);
      await prisma.occasion.updateMany({
        where: { accountId: account.id },
        data: { dispatchDate },
      });
    }

    it("reminds once the deadline is near, even though the date itself is weeks away", async () => {
      const email = `deadline-${randomUUID()}@example.com`;
      const token = await signUp(email);
      // A 20-day-away birthday whose card must be posted in four days — exactly
      // what the Christmas rush produces. The old window looked only at the
      // occasion date, so this customer heard nothing for another 13 days.
      await addRecipientWithBirthday(token, 20);
      await setDispatchDate(email, 4);

      await reminders.runDueReminders();
      expect(countEmailsTo(email)).toBe(1);
    });

    it("still reminds when the deadline has already gone but the date has not", async () => {
      // The most urgent case there is, and the one a lower bound on the window
      // would silently drop: the card is already late to post, but the birthday
      // is still ahead and the customer can still choose to send.
      const email = `overdue-${randomUUID()}@example.com`;
      const token = await signUp(email);
      await addRecipientWithBirthday(token, 6);
      await setDispatchDate(email, -3);

      await reminders.runDueReminders();
      expect(countEmailsTo(email)).toBe(1);
    });

    it("does not remind about a date that has already passed", async () => {
      const email = `gone-${randomUUID()}@example.com`;
      const token = await signUp(email);
      await addRecipientWithBirthday(token, 5);
      const account = await prisma.account.findFirstOrThrow({ where: { contactEmail: email } });
      const past = new Date();
      past.setUTCHours(0, 0, 0, 0);
      past.setUTCDate(past.getUTCDate() - 2);
      await prisma.occasion.updateMany({
        where: { accountId: account.id },
        data: { occasionDate: past, dispatchDate: past },
      });

      await reminders.runDueReminders();
      expect(countEmailsTo(email)).toBe(0);
    });

    it("tells the customer the date the card has to be posted by", async () => {
      const email = `postby-${randomUUID()}@example.com`;
      const token = await signUp(email);
      await addRecipientWithBirthday(token, 20);
      await setDispatchDate(email, 4);

      await reminders.runDueReminders();
      const digest = (sendTransactional.mock.calls as Array<[{ to: string; html: string }]>).find(
        (call) => call[0]?.to === email,
      );
      // A reminder that does not name the deadline cannot be acted on correctly.
      expect(digest?.[0]?.html).toMatch(/post by/i);
    });
  });
});
