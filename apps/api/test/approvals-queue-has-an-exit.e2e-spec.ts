import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { OccasionSchedulerService } from "../src/occasions/occasion-scheduler.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * The approvals queue lets go of what it can no longer send.
 *
 * Before this it had no exit. An occasion promoted into Approvals that nobody
 * actioned stayed there for ever, its date sliding into the past, and the pile
 * grew for as long as the account existed. A customer migrated in mid-August had
 * seventeen dead entries three weeks later.
 *
 * That pile is what did the damage: faced with birthdays they could no longer
 * act on, the customer cleared the queue by hand — twenty-seven clicks of "Skip"
 * at about one a second — and took ten live birthdays with them. The cards they
 * then paid for went out as one undated batch instead of on each child's day.
 */
describe("The approvals queue has an exit (e2e)", () => {
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
      .send({ type: "organisation", name: `Queue co ${randomUUID()}` })
      .expect(201);
    return { token, accountId: (created.body as { id: string }).id };
  }

  /** A birthday occasion `inDays` from today, in the given status. */
  async function occasion(
    accountId: string,
    inDays: number,
    status: "scheduled" | "pending_approval",
  ): Promise<string> {
    const recipient = await prisma.recipient.create({
      data: {
        accountId,
        firstName: "Queue",
        lastName: `Contact ${randomUUID().slice(0, 8)}`,
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
      },
    });
    const created = await prisma.occasion.create({
      data: {
        accountId,
        recipientId: recipient.id,
        type: "birthday",
        source: "recurring_per_recipient",
        occasionDate: utcDay(inDays),
        status,
      },
    });
    return created.id;
  }

  const statusOf = async (id: string) =>
    (await prisma.occasion.findUniqueOrThrow({ where: { id } })).status;

  function approvals(token: string) {
    return request(app.getHttpServer())
      .get("/occasions?status=pending_approval&perPage=50")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
  }

  it("retires an approval whose date has been, and leaves the live ones", async () => {
    const { token, accountId } = await account();
    const lapsed = await occasion(accountId, -3, "pending_approval");
    const live = await occasion(accountId, 9, "pending_approval");

    expect((await approvals(token)).body).toMatchObject({ total: 2 });

    await scheduler.scheduleBirthdayOccasions();

    expect(await statusOf(lapsed)).toBe("skipped");
    expect(await statusOf(live)).toBe("pending_approval");
    expect((await approvals(token)).body).toMatchObject({ total: 1 });
  });

  it("leaves a birthday that is today alone", async () => {
    // Too late to arrive on the day, but sending it late is the customer's call
    // to make — not ours to take away by retiring it under them.
    const { accountId } = await account();
    const today = await occasion(accountId, 0, "pending_approval");

    await scheduler.scheduleBirthdayOccasions();

    expect(await statusOf(today)).toBe("pending_approval");
  });

  it("never promotes an occasion whose date has already been", async () => {
    // The other half. Retiring the queue is pointless if the promotion keeps
    // refilling it from behind: the rule used to have an upper bound only,
    // resting on an invariant that holds when an occasion is created and says
    // nothing about it three weeks later.
    const { accountId } = await account();
    const past = await occasion(accountId, -5, "scheduled");

    await scheduler.scheduleBirthdayOccasions();

    expect(await statusOf(past)).toBe("scheduled");
  });

  it("still promotes a birthday inside the window", async () => {
    // The bound must not cost us the thing promotion is for.
    const { accountId } = await account();
    const soon = await occasion(accountId, 9, "scheduled");

    await scheduler.scheduleBirthdayOccasions();

    expect(await statusOf(soon)).toBe("pending_approval");
  });

  it("reports what it retired, so an operator running it by hand can see", async () => {
    const { accountId } = await account();
    await occasion(accountId, -2, "pending_approval");
    await occasion(accountId, -4, "pending_approval");

    const summary = await scheduler.scheduleBirthdayOccasions();

    expect(summary.lapsed).toBeGreaterThanOrEqual(2);
  });

  it("does not touch an approval the customer has already approved", async () => {
    // Only the queue is swept. An approved card is on its way and a past date on
    // it means the send is in flight, not that it lapsed.
    const { accountId } = await account();
    const id = await occasion(accountId, -3, "pending_approval");
    await prisma.occasion.update({ where: { id }, data: { status: "approved" } });

    await scheduler.scheduleBirthdayOccasions();

    expect(await statusOf(id)).toBe("approved");
  });
});
