import { randomUUID } from "node:crypto";
import type { FulfillmentCounts } from "@kudos/shared-types";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * A dispatch deadline is a question about work still to go out (ADR 0108 §5).
 *
 * Reported from the ops queue: five cards printed and sitting in Click & Drop,
 * all due to post today, and the queue's "Due today" chip read 0 — while the
 * banner at the top of the same screen said "5 cards to post today" and the
 * dispatch calendar showed 5 on that day. The due buckets counted `pending`
 * alone, on the reasoning that urgency is meaningless for a card already dealt
 * with. That holds for `posted` and `delivered`. It does not hold for `printed`
 * or `in_progress`: a printed card has not been posted, and its deadline is the
 * whole point.
 */
describe("Fulfillment due buckets span the open statuses (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let ops: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const userId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId, role: "super_admin" } });
    ops = await mintToken(userId);
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

  const todayIso = () => utcDay(0).toISOString().slice(0, 10);

  /**
   * A fulfillment job with a given status and deadline, built straight through
   * Prisma. The reads under test look only at `status` and `dueDate`, so going
   * through the whole pay → approve → order flow would add minutes and prove
   * nothing extra.
   */
  async function job(status: "pending" | "in_progress" | "printed" | "posted", dueIn: number) {
    const account = await prisma.account.create({
      data: { type: "organisation", name: `Queue co ${randomUUID()}`, planId: "centre" },
    });
    const recipient = await prisma.recipient.create({
      data: {
        accountId: account.id,
        firstName: "Queue",
        lastName: "Contact",
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
      },
    });
    const design = await prisma.cardDesign.findFirstOrThrow();
    const saved = await prisma.savedDesign.create({
      data: {
        accountId: account.id,
        cardDesignId: design.id,
        name: "Queue design",
        document: {},
      },
    });
    const order = await prisma.batchOrder.create({
      data: { accountId: account.id, status: "paid", totalMinor: 100 },
    });
    const orderRecipient = await prisma.orderRecipient.create({
      data: {
        batchOrderId: order.id,
        recipientId: recipient.id,
        savedDesignId: saved.id,
        shippingAddressLine1: "1 Test Street",
        shippingAddressCity: "London",
        shippingAddressPostcode: "SW1A 1AA",
        dispatchOption: "asap",
        postageClass: "second_class",
        priceMinor: 100,
      },
    });
    await prisma.fulfillmentJob.create({
      data: { orderRecipientId: orderRecipient.id, status, dueDate: utcDay(dueIn) },
    });
  }

  async function get<T>(path: string): Promise<T> {
    const response = await request(app.getHttpServer())
      .get(path)
      .set("Authorization", `Bearer ${ops}`)
      .expect(200);
    return response.body as T;
  }

  const counts = () => get<FulfillmentCounts>("/fulfillment/counts");
  const jobs = (query: string) => get<{ total: number }>(`/fulfillment/jobs?${query}&perPage=100`);

  beforeAll(async () => {
    // The reported shape: everything due today has already been printed, and
    // the only pending work is later in the week.
    for (let i = 0; i < 5; i++) await job("printed", 0);
    for (let i = 0; i < 3; i++) await job("pending", 3);
    // A card posted today is done. Its deadline is history, and it must stay
    // out of every bucket — that part of the old reasoning was right.
    await job("posted", 0);
  });

  it("counts a printed-but-not-posted card as due today", async () => {
    // The regression, in one line. This read 0.
    expect((await counts()).due.today).toBe(5);
  });

  it("agrees with the dispatch calendar and the send-by-5 banner", async () => {
    // The three screens an operator sees at once. They disagreed: the queue said
    // 0 while the banner above it and the calendar next to it both said 5.
    const iso = todayIso();
    const [chip, calendar, mustShip] = await Promise.all([
      counts(),
      get<{ days: { day: string; total: number }[] }>(
        `/fulfillment/calendar?from=${iso}&to=${iso}`,
      ),
      get<{ today: number }>("/fulfillment/must-ship"),
    ]);
    expect(chip.due.today).toBe(5);
    expect(calendar.days.find((d) => d.day === iso)?.total).toBe(5);
    expect(mustShip.today).toBe(5);
  });

  it("returns what the chip counted when the chip is clicked", async () => {
    // ADR 0108's invariant: the chip total and the filtered list always agree.
    // Preserved by moving both to the open statuses, not just the count.
    expect((await jobs("due=today")).total).toBe(5);
    expect((await counts()).due.today).toBe(5);
  });

  it("still narrows within a deadline when a status tab is chosen", async () => {
    // The tabs remain a filter, not a scope: the deadline spans open cards, and
    // picking a status cuts into it.
    expect((await jobs("status=pending&due=today")).total).toBe(0);
    expect((await jobs("status=printed&due=today")).total).toBe(5);
  });

  it("leaves the landing view alone", async () => {
    // No deadline question asked: still the actionable pending backlog. Widening
    // the buckets must not quietly widen the queue's front door.
    expect((await jobs("")).total).toBe(3);
  });

  it("treats an explicit `all` as the whole open workload", async () => {
    // 5 printed + 3 pending. The posted card is excluded — it has gone.
    expect((await jobs("due=all")).total).toBe(8);
  });

  it("keeps a posted card out of every bucket", async () => {
    const { due, status } = await counts();
    expect(status.posted).toBe(1);
    const bucketed = due.overdue + due.today + due.dueSoon + due.upcoming + due.noDate;
    // The buckets now partition the open workload — pending + in progress +
    // printed — rather than pending alone, and nothing beyond it.
    const open = (status.pending ?? 0) + (status.in_progress ?? 0) + (status.printed ?? 0);
    expect(bucketed).toBe(open);
    expect(bucketed).toBe(8);
  });
});
