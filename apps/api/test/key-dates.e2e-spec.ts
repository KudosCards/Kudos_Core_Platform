import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { OccasionSchedulerService } from "../src/occasions/occasion-scheduler.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * Recurring key dates (renewal / anniversary): setting one materialises a
 * scheduled occasion for its next annual occurrence (like a birthday from the
 * DOB), the scheduler promotes it near its date, and removing it clears the
 * still-scheduled occasion. See docs/adr/0104-recurring-key-dates.md.
 */
describe("Recipient key dates (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let scheduler: OccasionSchedulerService;
  /** Set by a test to make the next Occasion.createMany blow up. */
  let failNextOccasionCreateMany = false;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    scheduler = app.get(OccasionSchedulerService);

    // Middleware rather than a spy on the delegate: the write under test runs
    // through a transaction client, which a delegate spy would not see.
    prisma.$use(async (params, next) => {
      if (
        failNextOccasionCreateMany &&
        params.model === "Occasion" &&
        params.action === "createMany"
      ) {
        failNextOccasionCreateMany = false;
        throw new Error("simulated write failure");
      }
      const result: unknown = await next(params);
      return result;
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function signUpWithRecipient(): Promise<{ token: string; recipientId: string }> {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `KD Test ${randomUUID()}` })
      .expect(201);
    const recipientResponse = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Key",
        lastName: "Date",
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
      })
      .expect(201);
    return { token, recipientId: (recipientResponse.body as { id: string }).id };
  }

  it("materialises a scheduled occasion when a renewal date is set", async () => {
    const { token, recipientId } = await signUpWithRecipient();

    await request(app.getHttpServer())
      .put(`/recipients/${recipientId}/key-dates/renewal`)
      .set("Authorization", `Bearer ${token}`)
      .send({ date: "2020-03-15" })
      .expect(200);

    const occasions = await prisma.occasion.findMany({ where: { recipientId, type: "renewal" } });
    expect(occasions).toHaveLength(1);
    expect(occasions[0]).toMatchObject({ source: "recurring_per_recipient", status: "scheduled" });
    // The occasion is on the *next* 15 March, never a past date.
    expect(occasions[0]!.occasionDate.getTime()).toBeGreaterThanOrEqual(
      new Date(new Date().toISOString().slice(0, 10)).getTime() - 86_400_000,
    );
  });

  it("re-points the scheduled occasion when the date changes, and rejects a bad type", async () => {
    const { token, recipientId } = await signUpWithRecipient();
    const set = (date: string) =>
      request(app.getHttpServer())
        .put(`/recipients/${recipientId}/key-dates/anniversary`)
        .set("Authorization", `Bearer ${token}`)
        .send({ date })
        .expect(200);

    await set("2019-06-01");
    await set("2019-09-20");

    // Deliberately not filtered by status: whether the new date is far enough
    // out to sit `scheduled` or close enough to be promoted straight into
    // Approvals depends on today's date, and neither is what this test is
    // about — there must be exactly one occasion, on the new date.
    const occasions = await prisma.occasion.findMany({
      where: { recipientId, type: "anniversary" },
    });
    expect(occasions).toHaveLength(1);
    expect(occasions[0]!.occasionDate.getUTCMonth()).toBe(8); // September (0-indexed)

    await request(app.getHttpServer())
      .put(`/recipients/${recipientId}/key-dates/wedding`)
      .set("Authorization", `Bearer ${token}`)
      .send({ date: "2019-09-20" })
      .expect(400);
  });

  it("promotes a soon-due key-date occasion into the approvals queue on the scheduler run", async () => {
    const { token, recipientId } = await signUpWithRecipient();
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 10);
    const date = `2018-${String(soon.getUTCMonth() + 1).padStart(2, "0")}-${String(soon.getUTCDate()).padStart(2, "0")}`;

    await request(app.getHttpServer())
      .put(`/recipients/${recipientId}/key-dates/renewal`)
      .set("Authorization", `Bearer ${token}`)
      .send({ date })
      .expect(200);

    // Setting the date now promotes it eagerly, so put it back to `scheduled`
    // first — otherwise this passes without the scheduler doing anything and
    // stops being a test of the scheduler at all.
    await prisma.occasion.updateMany({
      where: { recipientId, type: "renewal" },
      data: { status: "scheduled" },
    });

    await scheduler.scheduleBirthdayOccasions();

    const occasion = await prisma.occasion.findFirst({ where: { recipientId, type: "renewal" } });
    expect(occasion?.status).toBe("pending_approval");
  });

  /** A date `days` from now, expressed as a past-year key date (the year is
   * ignored — the occasion is built for the next annual occurrence). */
  function keyDateIn(days: number): string {
    const when = new Date();
    when.setUTCDate(when.getUTCDate() + days);
    return `2018-${String(when.getUTCMonth() + 1).padStart(2, "0")}-${String(when.getUTCDate()).padStart(2, "0")}`;
  }

  it("puts a key date inside the approval window into Approvals immediately", async () => {
    const { token, recipientId } = await signUpWithRecipient();

    // A renewal ten days out is inside the approval window and its post-by date
    // is already here. Waiting for the 06:00 sweep to notice would show
    // "Nothing waiting for approval" all day, and promote it a day after the
    // date it needed to be posted by.
    await request(app.getHttpServer())
      .put(`/recipients/${recipientId}/key-dates/renewal`)
      .set("Authorization", `Bearer ${token}`)
      .send({ date: keyDateIn(10) })
      .expect(200);

    const occasion = await prisma.occasion.findFirstOrThrow({
      where: { recipientId, type: "renewal" },
    });
    expect(occasion.status).toBe("pending_approval");
  });

  it("does not leave the old occasion behind when a promoted key date is re-dated", async () => {
    const { token, recipientId } = await signUpWithRecipient();
    const set = (date: string) =>
      request(app.getHttpServer())
        .put(`/recipients/${recipientId}/key-dates/renewal`)
        .set("Authorization", `Bearer ${token}`)
        .send({ date })
        .expect(200);

    await set(keyDateIn(10));
    await set(keyDateIn(12));

    // One occasion, on the corrected date. The old one must not survive in the
    // approvals queue asking someone to send a card for a date the customer has
    // just told us is wrong.
    const occasions = await prisma.occasion.findMany({ where: { recipientId, type: "renewal" } });
    expect(occasions).toHaveLength(1);
    const expected = new Date();
    expected.setUTCDate(expected.getUTCDate() + 12);
    expect(occasions[0]!.occasionDate.toISOString().slice(5, 10)).toBe(
      expected.toISOString().slice(5, 10),
    );
  });

  it("keeps an approved occasion when only the label changes", async () => {
    const { token, recipientId } = await signUpWithRecipient();
    const date = keyDateIn(10);
    await request(app.getHttpServer())
      .put(`/recipients/${recipientId}/key-dates/renewal`)
      .set("Authorization", `Bearer ${token}`)
      .send({ date, label: "Membership" })
      .expect(200);
    const occasion = await prisma.occasion.findFirstOrThrow({
      where: { recipientId, type: "renewal" },
    });
    await prisma.occasion.update({ where: { id: occasion.id }, data: { status: "approved" } });

    // Renaming the key date is not a change of date. Deleting and recreating
    // the occasion would throw away an approval the customer has given and put
    // it back in the queue for them to approve a second time.
    await request(app.getHttpServer())
      .put(`/recipients/${recipientId}/key-dates/renewal`)
      .set("Authorization", `Bearer ${token}`)
      .send({ date, label: "Annual membership" })
      .expect(200);

    const after = await prisma.occasion.findMany({ where: { recipientId, type: "renewal" } });
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(occasion.id);
    expect(after[0]!.status).toBe("approved");
  });

  it("removes a promoted occasion too when the key date is deleted", async () => {
    const { token, recipientId } = await signUpWithRecipient();
    await request(app.getHttpServer())
      .put(`/recipients/${recipientId}/key-dates/renewal`)
      .set("Authorization", `Bearer ${token}`)
      .send({ date: keyDateIn(10) })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/recipients/${recipientId}/key-dates/renewal`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    // Deleting the key date must take its occasion with it whatever stage it
    // has reached, short of a card actually being paid for.
    expect(await prisma.occasion.count({ where: { recipientId, type: "renewal" } })).toBe(0);
  });

  it("leaves the existing occasion alone when re-pointing the date fails", async () => {
    const { token, recipientId } = await signUpWithRecipient();
    await request(app.getHttpServer())
      .put(`/recipients/${recipientId}/key-dates/renewal`)
      .set("Authorization", `Bearer ${token}`)
      .send({ date: keyDateIn(10) })
      .expect(200);
    const before = await prisma.occasion.findFirstOrThrow({
      where: { recipientId, type: "renewal" },
    });

    // The write that creates the replacement fails. The delete that precedes it
    // must not stand on its own, or the contact is left with a key date and no
    // occasion at all — nothing to approve, nothing to send, and no sign
    // anything is missing.
    failNextOccasionCreateMany = true;
    try {
      await request(app.getHttpServer())
        .put(`/recipients/${recipientId}/key-dates/renewal`)
        .set("Authorization", `Bearer ${token}`)
        .send({ date: keyDateIn(12) })
        .expect(500);
    } finally {
      failNextOccasionCreateMany = false;
    }

    const after = await prisma.occasion.findMany({ where: { recipientId, type: "renewal" } });
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(before.id);
  });

  it("removes the scheduled occasion when the key date is deleted", async () => {
    const { token, recipientId } = await signUpWithRecipient();
    await request(app.getHttpServer())
      .put(`/recipients/${recipientId}/key-dates/renewal`)
      .set("Authorization", `Bearer ${token}`)
      .send({ date: "2020-03-15" })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/recipients/${recipientId}/key-dates/renewal`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    const remaining = await prisma.occasion.findMany({
      where: { recipientId, type: "renewal", status: "scheduled" },
    });
    expect(remaining).toHaveLength(0);
    const keyDates = await prisma.recipientKeyDate.findMany({ where: { recipientId } });
    expect(keyDates).toHaveLength(0);
  });
});
