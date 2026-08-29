import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * Skipping is no longer a one-way door.
 *
 * It used to be: one click, no confirmation, no undo, and the occasion was gone
 * for the year — invisible to the approvals queue, to the send matcher, and to
 * the customer. A school clearing a queue of birthdays that had already passed
 * skipped twenty-seven of them in about as many seconds. Ten were live
 * birthdays weeks away, and the cards they then paid for went out as one
 * undated batch instead of on each child's day. Nothing in the product could
 * put them back; it took a hand-written UPDATE against production.
 */
describe("Restoring a skipped occasion (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let token: string;
  let accountId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    token = await mintToken(randomUUID());
    const created = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Unskip co ${randomUUID()}` })
      .expect(201);
    accountId = (created.body as { id: string }).id;
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

  /** A birthday occasion `inDays` away, in the approvals queue. */
  async function pending(inDays: number): Promise<string> {
    const recipient = await prisma.recipient.create({
      data: {
        accountId,
        firstName: "Unskip",
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
        status: "pending_approval",
      },
    });
    return created.id;
  }

  const post = (id: string, action: "skip" | "unskip") =>
    request(app.getHttpServer())
      .post(`/occasions/${id}/${action}`)
      .set("Authorization", `Bearer ${token}`);

  const statusOf = async (id: string) =>
    (await prisma.occasion.findUniqueOrThrow({ where: { id } })).status;

  it("puts a skipped birthday back in the queue", async () => {
    const id = await pending(9);
    await post(id, "skip").expect(201);
    expect(await statusOf(id)).toBe("skipped");

    await post(id, "unskip").expect(201);

    expect(await statusOf(id)).toBe("pending_approval");
  });

  it("makes the restored birthday matchable by a send again", async () => {
    // The point of restoring it. A skipped occasion is invisible to the send
    // matcher, which is how twelve cards meant for twelve birthdays became one
    // undated batch — so the test that matters is not the status but whether a
    // send can see it again.
    const id = await pending(9);
    const visible = async () => {
      const response = await request(app.getHttpServer())
        .get("/occasions?status=pending_approval&perPage=50")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      return (response.body as { items: { id: string }[] }).items.some((o) => o.id === id);
    };

    expect(await visible()).toBe(true);
    await post(id, "skip").expect(201);
    expect(await visible()).toBe(false);
    await post(id, "unskip").expect(201);
    expect(await visible()).toBe(true);
  });

  it("refuses to restore a date that has already been", async () => {
    // Restoring a birthday that has gone would put an un-sendable card back in
    // the queue — the pile the nightly sweep exists to retire, and the pile that
    // caused the mass-skip in the first place.
    const id = await pending(-3);
    await post(id, "skip").expect(201);

    await post(id, "unskip").expect(409);

    expect(await statusOf(id)).toBe("skipped");
  });

  it("refuses an occasion that was never skipped", async () => {
    const id = await pending(9);
    await post(id, "unskip").expect(409);
    expect(await statusOf(id)).toBe("pending_approval");
  });

  it("records who restored it", async () => {
    // Same trail as the skip it undoes, so a support conversation can see both
    // halves rather than an unexplained status change.
    const id = await pending(9);
    await post(id, "skip").expect(201);
    await post(id, "unskip").expect(201);

    const entries = await prisma.auditLogEntry.findMany({
      where: { accountId, targetType: "Occasion", targetId: id },
      orderBy: { createdAt: "asc" },
      select: { action: true },
    });
    expect(entries.map((e) => e.action)).toEqual(["skip", "unskip"]);
  });

  it("is account-scoped", async () => {
    const id = await pending(9);
    await post(id, "skip").expect(201);

    const otherToken = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ type: "organisation", name: `Nosy co ${randomUUID()}` })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/occasions/${id}/unskip`)
      .set("Authorization", `Bearer ${otherToken}`)
      .expect(404);

    expect(await statusOf(id)).toBe("skipped");
  });
});
