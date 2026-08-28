import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * The calendar's read (ADR 0173).
 *
 * Reported by a customer with two thousand contacts: the month view showed
 * nothing after 17 September, while the week view covering that same date showed
 * the days either side in full. The calendar was asking the paginated
 * `/occasions` list for one page of 100 and drawing whatever came back —
 * `parsePerPage` caps at 100, so a month grid holding ~230 events was cut off
 * partway through a day, silently.
 */
describe("Occasions calendar (e2e)", () => {
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
      .send({ type: "organisation", name: `Calendar Co ${randomUUID()}` })
      .expect(201);
    accountId = (created.body as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * `count` occasions spread over `days` consecutive days from `startsIn`.
   *
   * Each batch gets its own surname tag so it seeds occasions for the contacts
   * it just made and nobody else's — selecting every recipient on the account
   * would silently give a later batch occasions for the earlier batches'
   * contacts too, and the totals would stop meaning what they say.
   */
  async function seedOccasions(count: number, days: number, startsIn = 1): Promise<void> {
    const tag = randomUUID();
    const recipients = Array.from({ length: count }, (_, i) => ({
      accountId,
      firstName: "Contact",
      lastName: `${tag}-${i}`,
      addressLine1: "1 Test Street",
      addressCity: "London",
      addressPostcode: "SW1A 1AA",
      status: "active" as const,
    }));
    await prisma.recipient.createMany({ data: recipients });
    const rows = await prisma.recipient.findMany({
      where: { accountId, lastName: { startsWith: tag } },
      select: { id: true },
    });
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    await prisma.occasion.createMany({
      data: rows.map((r, i) => {
        const date = new Date(today);
        date.setUTCDate(date.getUTCDate() + startsIn + (i % days));
        return {
          accountId,
          recipientId: r.id,
          type: "birthday" as const,
          source: "recurring_per_recipient" as const,
          occasionDate: date,
          status: "scheduled" as const,
        };
      }),
      skipDuplicates: true,
    });
  }

  function range(days: number): string {
    const from = new Date();
    from.setUTCHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + days);
    return `from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`;
  }

  function calendar(query: string) {
    return request(app.getHttpServer())
      .get(`/occasions/calendar?${query}`)
      .set("Authorization", `Bearer ${token}`);
  }

  it("returns the whole range, past the 100 the paginated list stops at", async () => {
    // The regression. 250 occasions over 40 days is the shape of a month grid on
    // a two-thousand-contact account; the old read returned 100 of them.
    await seedOccasions(250, 40);

    const response = await calendar(range(60)).expect(200);
    const body = response.body as { items: unknown[]; total: number; truncated: boolean };
    expect(body.items).toHaveLength(250);
    expect(body.total).toBe(250);
    expect(body.truncated).toBe(false);

    // And the old endpoint still does what it always did, so the contrast is
    // documented rather than remembered: it is capped, deliberately.
    const list = await request(app.getHttpServer())
      .get(`/occasions?${range(60)}&perPage=500`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect((list.body as { items: unknown[] }).items).toHaveLength(100);
  });

  it("never sends a contact's postal address to a page that renders none", async () => {
    // The calendar draws a name on a pill. The full `/occasions` list carries
    // the address so checkout can pre-fill a shipping line (ADR 0119) — that is
    // 428 bytes a row this page has no use for, on every pill in a grid.
    const response = await calendar(range(60)).expect(200);
    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain("addressLine1");
    expect(raw).not.toContain("SW1A 1AA");
    // …but the name it does draw is there.
    expect(raw).toContain("firstName");
  });

  it("says so when a range is too big to return whole", async () => {
    // Silence is the actual bug. A reader who is not seeing everything has to be
    // told, and told by the server rather than by the client comparing numbers.
    await seedOccasions(900, 5, 200);

    const response = await calendar(range(400)).expect(200);
    const body = response.body as { items: unknown[]; total: number; truncated: boolean };
    expect(body.truncated).toBe(true);
    expect(body.items).toHaveLength(1000);
    expect(body.total).toBe(1150);
  });

  it("honours the occasion-type filter the calendar's dropdown sets", async () => {
    const other = await prisma.recipient.findFirstOrThrow({ where: { accountId } });
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() + 2);
    await prisma.occasion.create({
      data: {
        accountId,
        recipientId: other.id,
        type: "leaver",
        source: "one_off_campaign",
        occasionDate: date,
        status: "scheduled",
      },
    });

    const response = await calendar(`${range(60)}&type=leaver`).expect(200);
    const body = response.body as { items: { type: string }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.type).toBe("leaver");
  });

  it("hides an archived contact's events, like every other account-wide view", async () => {
    const victim = await prisma.recipient.findFirstOrThrow({
      where: { accountId, status: "active" },
    });
    const before = (await calendar(range(60)).expect(200)).body as { total: number };
    await prisma.recipient.update({ where: { id: victim.id }, data: { status: "archived" } });
    const after = (await calendar(range(60)).expect(200)).body as { total: number };
    expect(after.total).toBeLessThan(before.total);
  });

  it("refuses a range with an open end", async () => {
    // This read returns its range rather than a page of it, so an open end would
    // be an unbounded query. A calendar always knows both ends of its window.
    await calendar("from=2026-01-01").expect(400);
    await calendar("to=2026-12-31").expect(400);
    await calendar("from=not-a-date&to=2026-12-31").expect(400);
  });

  it("is account-scoped", async () => {
    const otherToken = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ type: "organisation", name: `Nosy Co ${randomUUID()}` })
      .expect(201);
    const response = await request(app.getHttpServer())
      .get(`/occasions/calendar?${range(60)}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .expect(200);
    expect((response.body as { total: number }).total).toBe(0);
  });
});
