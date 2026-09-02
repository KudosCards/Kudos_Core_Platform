import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * A key date only clears its own occasions.
 *
 * Setting or removing a contact's renewal/anniversary key date deletes the
 * occasions for that key date — correctly, because the customer has just said
 * that date is wrong. Both deletes matched on `(recipientId, type, status)` with
 * no `source`, so anything else carrying the same type against the same contact
 * was swept up with it: a shared event's card, or a one-off the customer added
 * by hand.
 *
 * Unlike the birthday realign (ADR 0221), this one is not reachable through the
 * product today — neither `anniversary` nor `renewal` is offered in the
 * shared-event or one-off pickers. It is reachable through the API, which is
 * what these tests use, and it arms the moment either dropdown gains one of
 * those two types. Closing it now costs a `where` clause; finding it later costs
 * somebody's approved card.
 */
describe("A key date keeps what it does not own (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  function isoDay(offset: number): string {
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    day.setUTCDate(day.getUTCDate() + offset);
    return day.toISOString().slice(0, 10);
  }

  async function account(): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID());
    const created = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Key co ${randomUUID()}` })
      .expect(201);
    return { token, accountId: (created.body as { id: string }).id };
  }

  async function contact(accountId: string): Promise<string> {
    const recipient = await prisma.recipient.create({
      data: {
        accountId,
        firstName: "Priya",
        lastName: `Member ${randomUUID().slice(0, 8)}`,
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
      },
    });
    return recipient.id;
  }

  /** A shared event of the same type as a key date, through the real endpoint —
   * `CreateEventDto.type` accepts the whole OccasionType enum. */
  async function sharedEventCard(
    token: string,
    recipientId: string,
    dayOffset: number,
  ): Promise<string> {
    await request(app.getHttpServer())
      .post("/events")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Work anniversaries — November",
        type: "anniversary",
        eventDate: isoDay(dayOffset),
        recipientIds: [recipientId],
      })
      .expect(201);
    const occasion = await prisma.occasion.findFirstOrThrow({
      where: { recipientId, source: "shared_event" },
    });
    return occasion.id;
  }

  const survives = async (id: string) =>
    (await prisma.occasion.findUnique({ where: { id } })) !== null;

  const keyDate = (token: string, recipientId: string) =>
    request(app.getHttpServer())
      .put(`/recipients/${recipientId}/key-dates/anniversary`)
      .set("Authorization", `Bearer ${token}`);

  it("keeps an approved cohort card when the key date is set", async () => {
    const { token, accountId } = await account();
    const recipientId = await contact(accountId);
    const cohort = await sharedEventCard(token, recipientId, 20);
    await prisma.occasion.update({ where: { id: cohort }, data: { status: "approved" } });

    await keyDate(token, recipientId)
      .send({ date: isoDay(45) })
      .expect(200);

    expect(await survives(cohort)).toBe(true);
  });

  it("keeps an approved cohort card when the key date is removed", async () => {
    const { token, accountId } = await account();
    const recipientId = await contact(accountId);
    const cohort = await sharedEventCard(token, recipientId, 20);
    await prisma.occasion.update({ where: { id: cohort }, data: { status: "approved" } });
    await keyDate(token, recipientId)
      .send({ date: isoDay(45) })
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/recipients/${recipientId}/key-dates/anniversary`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    expect(await survives(cohort)).toBe(true);
  });

  it("still clears its own occasion for a date the customer corrected", async () => {
    // The guard must not stop the key date doing its job: re-dating it leaves
    // nothing behind on the old date asking for a card.
    const { token, accountId } = await account();
    const recipientId = await contact(accountId);
    await keyDate(token, recipientId)
      .send({ date: isoDay(30) })
      .expect(200);
    const first = await prisma.occasion.findFirstOrThrow({
      where: { recipientId, source: "recurring_per_recipient", type: "anniversary" },
    });

    await keyDate(token, recipientId)
      .send({ date: isoDay(60) })
      .expect(200);

    expect(await survives(first.id)).toBe(false);
  });

  it("still removes its own occasion when the key date is deleted", async () => {
    const { token, accountId } = await account();
    const recipientId = await contact(accountId);
    await keyDate(token, recipientId)
      .send({ date: isoDay(30) })
      .expect(200);
    const own = await prisma.occasion.findFirstOrThrow({
      where: { recipientId, source: "recurring_per_recipient", type: "anniversary" },
    });

    await request(app.getHttpServer())
      .delete(`/recipients/${recipientId}/key-dates/anniversary`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    expect(await survives(own.id)).toBe(false);
  });
});
