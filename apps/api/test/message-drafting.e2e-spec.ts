import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema, standingOrderSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { DRAFTS_PER_ACCOUNT_PER_DAY } from "../src/standing-orders/message-drafting.service";
import { MESSAGE_DRAFTER } from "../src/standing-orders/message-drafter.provider";
import {
  MessageDraftingError,
  type DraftRequest,
  type MessageDrafter,
} from "../src/standing-orders/message-drafting.client";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * Drafting messages, everywhere except the model itself.
 *
 * The drafter is stubbed through its provider, the way STRIPE_CLIENT and
 * CATALOG_SOURCE are — not only so the suite is fast and offline, but because
 * a test that reached the real API would send a brief to a model, and a test
 * suite is not something anybody consented to. What the real client puts in
 * the request body is pinned next door, in message-drafting.client.spec.ts.
 */

const DRAFTS = [
  "Happy birthday {firstName} — have a lovely day.",
  "Many happy returns, {firstName}!",
];

/** Records what it was asked for, and answers with whatever the test set. */
class StubDrafter implements MessageDrafter {
  readonly seen: DraftRequest[] = [];
  next: { drafts: string[] } | { throws: Error } = { drafts: DRAFTS };

  draftBirthdayMessages(request: DraftRequest): Promise<string[]> {
    this.seen.push(request);
    if ("throws" in this.next) return Promise.reject(this.next.throws);
    return Promise.resolve(this.next.drafts);
  }
}

describe("Message drafting (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const drafter = new StubDrafter();

  beforeAll(async () => {
    app = await createTestApp([{ provide: MESSAGE_DRAFTER, useValue: drafter }]);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    drafter.seen.length = 0;
    drafter.next = { drafts: DRAFTS };
  });

  async function proAccount(): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID());
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Bright Sparks ${randomUUID()}` })
      .expect(201);
    const accountId = accountSchema.parse(response.body).id;
    await prisma.account.update({ where: { id: accountId }, data: { planId: "pro" } });
    return { token, accountId };
  }

  function draft(token: string, body: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post("/standing-order/message-drafts")
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  }

  it("returns drafts, and records that it did", async () => {
    const { token, accountId } = await proAccount();

    const response = await draft(token, { brief: "warm, a bit funny" }).expect(201);
    expect((response.body as { drafts: string[] }).drafts).toEqual(DRAFTS);

    // The audit row is the daily cap's only counter, so a draft that is not
    // recorded is a draft that does not count.
    const audited = await prisma.auditLogEntry.count({
      where: { accountId, action: "draft_messages" },
    });
    expect(audited).toBe(1);
  });

  it("sends the brief and the business name, and not one thing about a contact", async () => {
    // The whole safety argument for this feature, asserted against the bytes
    // that actually left the process.
    const { token, accountId } = await proAccount();
    await prisma.recipient.create({
      data: {
        accountId,
        firstName: "Marguerite",
        lastName: "Ashdown-Pryce",
        dateOfBirth: new Date("1988-03-14"),
        addressLine1: "12 Bell Lane",
        addressCity: "Leeds",
        addressPostcode: "LS1 4AB",
      },
    });

    await draft(token, { brief: "warm, a bit funny" }).expect(201);

    expect(drafter.seen).toHaveLength(1);
    const sent = JSON.stringify(drafter.seen[0]);
    expect(sent).toContain("warm, a bit funny");
    expect(sent).toContain("Bright Sparks");
    for (const secret of ["Marguerite", "Ashdown-Pryce", "1988", "Bell Lane", "LS1 4AB"]) {
      expect(sent).not.toContain(secret);
    }
    // Two fields, and they are these two. A third one added later has to come
    // through here.
    expect(Object.keys(drafter.seen[0]!).sort()).toEqual(["brief", "businessName"]);
  });

  it("withholds the account name when the account is a person", async () => {
    // On a personal account the name is somebody's actual name, and the
    // argument above does not get an exception for the one person who did not
    // ask to be in it.
    const token = await mintToken(randomUUID());
    const created = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "individual", name: "Harriet Quill" })
      .expect(201);
    await prisma.account.update({
      where: { id: accountSchema.parse(created.body).id },
      data: { planId: "pro" },
    });

    await draft(token).expect(201);
    expect(drafter.seen[0]!.businessName).toBeNull();
  });

  it("tells the subscriber plainly when the model cannot be reached", async () => {
    const { token } = await proAccount();
    drafter.next = {
      throws: new MessageDraftingError("upstream", "Anthropic returned 500: overloaded"),
    };

    const response = await draft(token).expect(503);
    expect(String((response.body as { message: string }).message)).toMatch(
      /could not write any suggestions/i,
    );
  });

  it("refuses to pass on a reply it cannot use", async () => {
    const { token, accountId } = await proAccount();
    drafter.next = {
      throws: new MessageDraftingError("unusable", "Anthropic did not return a list of messages"),
    };

    await draft(token).expect(503);
    // Nothing was drafted, so nothing was spent: a failed call must not eat
    // into the day's allowance.
    expect(
      await prisma.auditLogEntry.count({ where: { accountId, action: "draft_messages" } }),
    ).toBe(0);
  });

  it("stops at the day's limit, and says why", async () => {
    const { token, accountId } = await proAccount();
    const user = await prisma.membership.findFirstOrThrow({ where: { accountId } });
    await prisma.auditLogEntry.createMany({
      data: Array.from({ length: DRAFTS_PER_ACCOUNT_PER_DAY }, () => ({
        accountId,
        actorUserId: user.userId,
        action: "draft_messages",
        targetType: "StandingOrder",
        targetId: accountId,
      })),
    });

    const response = await draft(token).expect(429);
    expect(String((response.body as { message: string }).message)).toMatch(/limit/i);
    // Refused here, not at the model: a capped account costs nothing.
    expect(drafter.seen).toHaveLength(0);
  });

  it("does not count yesterday's drafts against today", async () => {
    const { token, accountId } = await proAccount();
    const user = await prisma.membership.findFirstOrThrow({ where: { accountId } });
    await prisma.auditLogEntry.createMany({
      data: Array.from({ length: DRAFTS_PER_ACCOUNT_PER_DAY }, () => ({
        accountId,
        actorUserId: user.userId,
        action: "draft_messages",
        targetType: "StandingOrder",
        targetId: accountId,
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      })),
    });

    await draft(token).expect(201);
  });

  it("keeps one account's allowance out of another's", async () => {
    const { token: first, accountId } = await proAccount();
    const user = await prisma.membership.findFirstOrThrow({ where: { accountId } });
    await prisma.auditLogEntry.createMany({
      data: Array.from({ length: DRAFTS_PER_ACCOUNT_PER_DAY }, () => ({
        accountId,
        actorUserId: user.userId,
        action: "draft_messages",
        targetType: "StandingOrder",
        targetId: accountId,
      })),
    });
    await draft(first).expect(429);

    const { token: second } = await proAccount();
    await draft(second).expect(201);
  });

  it("says the button is available", async () => {
    const { token } = await proAccount();
    const order = standingOrderSchema.parse(
      (
        await request(app.getHttpServer())
          .get("/standing-order")
          .set("Authorization", `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    expect(order.messageDraftingAvailable).toBe(true);
  });
});

describe("Message drafting, not configured (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    // No key configured means the provider hands over nothing at all.
    app = await createTestApp([{ provide: MESSAGE_DRAFTER, useValue: null }]);
  });

  afterAll(async () => {
    await app.close();
  });

  it("does not offer the button, and refuses the route", async () => {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `No Model ${randomUUID()}` })
      .expect(201);

    const order = standingOrderSchema.parse(
      (
        await request(app.getHttpServer())
          .get("/standing-order")
          .set("Authorization", `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    expect(order.messageDraftingAvailable).toBe(false);

    // A stale tab, or somebody with curl. Either way it is the truth rather
    // than a pretend draft.
    await request(app.getHttpServer())
      .post("/standing-order/message-drafts")
      .set("Authorization", `Bearer ${token}`)
      .send({})
      .expect(503);
  });
});
