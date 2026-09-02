import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * A shared event's card is not the birthday realign's to delete.
 *
 * `realignBirthdayOccasion` reads every `type: "birthday"` row for a contact and
 * keeps exactly one — the row sitting on the corrected date. It tags what it
 * *creates* with `source: "recurring_per_recipient"` and never filtered its
 * *reads* on the same column, so a shared event of type birthday ("September
 * birthdays", a cohort card the whole class gets) was picked up as a rival
 * birthday row, ranked as a loser, and hard-deleted.
 *
 * The contact page sends `dateOfBirth` on every save (the finding 21 fix), so
 * the realign runs on any edit at all. Correcting a postcode was enough to
 * destroy an approved cohort card and the design chosen for it.
 *
 * `birthday` is offered in the shared-event type picker, so this needs no API
 * call and no race — only a customer editing a contact.
 */
describe("A shared event survives a contact edit (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  function utcDay(offset: number): Date {
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    day.setUTCDate(day.getUTCDate() + offset);
    return day;
  }

  async function account(): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID());
    const created = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Event co ${randomUUID()}` })
      .expect(201);
    return { token, accountId: (created.body as { id: string }).id };
  }

  /** A contact with a real date of birth, so the realign has a target to hold. */
  async function contact(accountId: string): Promise<string> {
    const dob = utcDay(40);
    const recipient = await prisma.recipient.create({
      data: {
        accountId,
        firstName: "Priya",
        lastName: `Member ${randomUUID().slice(0, 8)}`,
        dateOfBirth: new Date(Date.UTC(1990, dob.getUTCMonth(), dob.getUTCDate())),
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
      },
    });
    return recipient.id;
  }

  /** The contact's own recurring birthday, as the scheduler would write it. */
  async function recurringBirthday(accountId: string, recipientId: string): Promise<string> {
    const created = await prisma.occasion.create({
      data: {
        accountId,
        recipientId,
        type: "birthday",
        source: "recurring_per_recipient",
        occasionDate: utcDay(40),
        status: "scheduled",
      },
    });
    return created.id;
  }

  /** A cohort card: one shared event, type birthday, on its own date. */
  async function sharedEventCard(
    accountId: string,
    recipientId: string,
    status: "scheduled" | "approved",
  ): Promise<string> {
    const event = await prisma.event.create({
      data: {
        accountId,
        type: "birthday",
        title: "September birthdays",
        eventDate: utcDay(20),
      },
    });
    const created = await prisma.occasion.create({
      data: {
        accountId,
        recipientId,
        eventId: event.id,
        type: "birthday",
        source: "shared_event",
        title: "September birthdays",
        occasionDate: utcDay(20),
        status,
      },
    });
    return created.id;
  }

  const survives = async (id: string) =>
    (await prisma.occasion.findUnique({ where: { id } })) !== null;

  it("keeps an approved cohort card when an unrelated field is edited", async () => {
    const { token, accountId } = await account();
    const recipientId = await contact(accountId);
    const birthday = await recurringBirthday(accountId, recipientId);
    const cohort = await sharedEventCard(accountId, recipientId, "approved");

    // A postcode correction. The contact page sends dateOfBirth on every save,
    // so this runs the realign even though the birthday has not moved.
    await request(app.getHttpServer())
      .patch(`/recipients/${recipientId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ addressPostcode: "SW1A 2AA", dateOfBirth: "1990-06-15" })
      .expect(200);

    expect(await survives(cohort)).toBe(true);
    expect(await survives(birthday)).toBe(true);
  });

  it("keeps a cohort card when the contact's date of birth is cleared", async () => {
    // The no-date-of-birth branch discards every live row. A contact with no
    // birthday still belongs to the September cohort.
    const { token, accountId } = await account();
    const recipientId = await contact(accountId);
    const cohort = await sharedEventCard(accountId, recipientId, "approved");

    await request(app.getHttpServer())
      .patch(`/recipients/${recipientId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dateOfBirth: null })
      .expect(200);

    expect(await survives(cohort)).toBe(true);
  });

  it("still retires the contact's own duplicate birthday rows", async () => {
    // The guard must not stop the realign doing its actual job: a stale
    // recurring row on the wrong date is still surplus and still goes.
    const { token, accountId } = await account();
    const recipientId = await contact(accountId);
    // Two of the contact's own rows on different dates, neither on the target.
    // One live row alone is *moved* rather than discarded, so a surplus row is
    // the only thing that exercises the discard path at all.
    await prisma.occasion.create({
      data: {
        accountId,
        recipientId,
        type: "birthday",
        source: "recurring_per_recipient",
        occasionDate: utcDay(40),
        status: "approved",
      },
    });
    const stale = await prisma.occasion.create({
      data: {
        accountId,
        recipientId,
        type: "birthday",
        source: "recurring_per_recipient",
        occasionDate: utcDay(75),
        status: "scheduled",
      },
    });

    await request(app.getHttpServer())
      .patch(`/recipients/${recipientId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dateOfBirth: "1990-06-15" })
      .expect(200);

    expect(await survives(stale.id)).toBe(false);
  });

  it("gives way when the cohort card sits on the corrected birthday itself", async () => {
    // The unique key is (recipient, type, date) with no source column, so a
    // cohort card on the target date genuinely occupies it. The realign must
    // treat it as a blocker and let its own row give way — moving the keeper
    // onto that date is the P2002, and the 500, that ADR 0185 removed.
    const { token, accountId } = await account();
    const target = utcDay(30);
    const recipient = await prisma.recipient.create({
      data: {
        accountId,
        firstName: "Sam",
        lastName: `Onthedate ${randomUUID().slice(0, 8)}`,
        dateOfBirth: new Date(Date.UTC(1990, target.getUTCMonth(), target.getUTCDate())),
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
      },
    });
    const event = await prisma.event.create({
      data: { accountId, type: "birthday", title: "Cohort", eventDate: target },
    });
    const cohort = await prisma.occasion.create({
      data: {
        accountId,
        recipientId: recipient.id,
        eventId: event.id,
        type: "birthday",
        source: "shared_event",
        occasionDate: target,
        status: "approved",
      },
    });
    await prisma.occasion.create({
      data: {
        accountId,
        recipientId: recipient.id,
        type: "birthday",
        source: "recurring_per_recipient",
        occasionDate: utcDay(60),
        status: "scheduled",
      },
    });

    const dob = `1990-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(
      target.getUTCDate(),
    ).padStart(2, "0")}`;
    await request(app.getHttpServer())
      .patch(`/recipients/${recipient.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ dateOfBirth: dob })
      .expect(200);

    expect(await survives(cohort.id)).toBe(true);
  });
});
