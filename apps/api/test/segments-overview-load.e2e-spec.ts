import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { SEGMENT_PRESETS } from "../src/segments/segment-presets";
import { RESOLVE_CONCURRENCY, SegmentsService } from "../src/segments/segments.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * The Lists page resolves every suggested preset and every saved smart list on
 * load, each as its own database transaction. It used to start them all at once:
 * an account with 40 saved lists demanded 45 transactions — 90 concurrent
 * queries — from one page load, and a handful of such loads is enough to
 * saturate a pgBouncer transaction pool and time out requests that have nothing
 * to do with this page. See ADR 0210.
 */
describe("Segments overview under load (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let segments: SegmentsService;

  /** Peak concurrent Prisma operations, reset per measurement. */
  let inFlight = 0;
  let peak = 0;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    segments = app.get(SegmentsService);
    // A delegate spy would miss these: each resolve runs inside $transaction, so
    // the queries go through a transaction client, not the delegate we'd watch.
    // Middleware sees every operation either way.
    prisma.$use(async (params, next) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        return (await next(params)) as unknown;
      } finally {
        inFlight -= 1;
      }
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function accountWithLists(savedLists: number): Promise<string> {
    const token = await mintToken(randomUUID());
    const res = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Load ${randomUUID()}` })
      .expect(201);
    const accountId = (res.body as { id: string }).id;

    for (let i = 0; i < savedLists; i += 1) {
      await prisma.segment.create({
        data: {
          accountId,
          name: `List ${i}`,
          // Alternating modes, because occasion-mode joins occasions to
          // recipients and is the more expensive of the two.
          definition:
            i % 2 === 0
              ? { occasion: { types: ["birthday"], window: { kind: "next_days", days: 60 } } }
              : { contact: { hasMailableAddress: true } },
        },
      });
    }
    return accountId;
  }

  it("holds the pool ceiling however many lists an account has saved", async () => {
    const accountId = await accountWithLists(40);

    peak = 0;
    const overview = await segments.overview(accountId);

    // Two queries per resolve (count + sample) share one transaction, so the
    // ceiling in queries is twice the resolve limit. Unbounded this was 90.
    expect(peak).toBeLessThanOrEqual(RESOLVE_CONCURRENCY * 2);
    // The assertion above is relative to the declared limit, so it would follow
    // that limit anywhere. This is the absolute one: the whole point is what a
    // single page load may take from the pool, and a large limit is the bug
    // wearing a constant. Measured wall-clock is flat from 6 upward.
    expect(RESOLVE_CONCURRENCY).toBeLessThanOrEqual(12);
    // The whole page is still there — a bound that dropped work would pass the
    // assertion above and be a far worse bug than the one it fixes.
    expect(overview.saved).toHaveLength(40);
    expect(overview.suggested.length).toBeGreaterThan(0);
  }, 120_000);

  it("pairs every saved list with its own count, not a neighbour's", async () => {
    // The bounded pass resolves presets and saved lists together and puts the
    // answers back by index. If that index arithmetic slips, every list still
    // gets a plausible count — just the wrong one. Distinct, checkable counts
    // are the only way to see it.
    const token = await mintToken(randomUUID());
    const res = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Pairing ${randomUUID()}` })
      .expect(201);
    const accountId = (res.body as { id: string }).id;

    const address = {
      addressLine1: "1 Test Street",
      addressCity: "London",
      addressPostcode: "SW1A 1AA",
    };
    const seed: { source: string; mailable: boolean }[] = [
      { source: "manual", mailable: true },
      { source: "manual", mailable: true },
      { source: "manual", mailable: true },
      { source: "csv", mailable: true },
      { source: "csv", mailable: true },
      { source: "crm", mailable: false },
    ];
    for (const [i, contact] of seed.entries()) {
      await prisma.recipient.create({
        data: {
          accountId,
          firstName: "Pair",
          lastName: `${i}`,
          source: contact.source,
          ...(contact.mailable ? address : {}),
        },
      });
    }

    // Four rules over the same six contacts, chosen so no two counts collide —
    // a mismatched pairing cannot hide behind a coincidence.
    const lists = [
      { name: "From manual", definition: { contact: { source: "manual" } }, count: 3 },
      { name: "From CSV", definition: { contact: { source: "csv" } }, count: 2 },
      { name: "No address", definition: { contact: { hasMailableAddress: false } }, count: 1 },
      { name: "Mailable", definition: { contact: { hasMailableAddress: true } }, count: 5 },
      // A fifth, so there are as many saved lists as presets: an index slip
      // between the two halves of the pass has somewhere to land instead of
      // falling off the end and looking correct.
      { name: "Everyone", definition: { contact: {} }, count: 6 },
    ];
    for (const [i, list] of lists.entries()) {
      await prisma.segment.create({
        data: {
          accountId,
          name: list.name,
          definition: list.definition,
          // Explicit, so "newest first" is a fact rather than a race between
          // creates that can land in the same millisecond.
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
        },
      });
    }

    const overview = await segments.overview(accountId);

    expect(overview.saved.map((s) => ({ name: s.name, count: s.count }))).toEqual(
      [...lists].reverse().map((l) => ({ name: l.name, count: l.count })),
    );
    // The rule and the preview travel with their own list too, not just the
    // count — the sample is what the card actually shows.
    for (const list of lists) {
      const summary = overview.saved.find((s) => s.name === list.name)!;
      expect(summary.definition).toEqual(list.definition);
      expect(summary.id).toBe(summary.key);
      expect(summary.suggested).toBe(false);
      expect(summary.sample).toHaveLength(Math.min(list.count, 8));
    }
    // The one contact with no address is the only member of "No address", so
    // its preview names that person and nobody else.
    expect(overview.saved.find((s) => s.name === "No address")!.sample).toEqual([
      { recipientId: expect.any(String), name: "Pair 5", detail: "No postal address" },
    ]);

    // The presets share the same bounded pass, so they can be mispaired the
    // same way — and only an account that also has saved lists can show it.
    // "Missing an address" matches the one contact with no address; no saved
    // list here has that count, so a slip cannot land on the right answer.
    const missingAddress = overview.suggested.find((s) => s.key === "missing-address");
    expect(missingAddress?.count).toBe(1);
    expect(overview.suggested.map((s) => s.key)).toEqual(SEGMENT_PRESETS.map((p) => p.key));
    expect(overview.suggested.every((s) => s.suggested && s.id === null)).toBe(true);
  }, 120_000);
});
