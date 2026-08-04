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

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    scheduler = app.get(OccasionSchedulerService);
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

    const occasions = await prisma.occasion.findMany({
      where: { recipientId, type: "anniversary", status: "scheduled" },
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

    await scheduler.scheduleBirthdayOccasions();

    const occasion = await prisma.occasion.findFirst({ where: { recipientId, type: "renewal" } });
    expect(occasion?.status).toBe("pending_approval");
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
