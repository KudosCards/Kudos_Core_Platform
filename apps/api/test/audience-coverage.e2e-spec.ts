import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema, contactReadinessSchema, walletProjectionSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * What click and forget tells somebody before they hand their birthdays over:
 * how many contacts it actually covers, and whether their money reaches them.
 *
 * Both numbers already existed — one as a CRM import summary, one as a 9am
 * email — and neither could be asked for. See ADR 0264.
 */

describe("Audience coverage and wallet projection (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function proAccount(): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID());
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Test Centre ${randomUUID()}` })
      .expect(201);
    const accountId = accountSchema.parse(response.body).id;
    await prisma.account.update({ where: { id: accountId }, data: { planId: "pro" } });
    return { token, accountId };
  }

  const POSTABLE = {
    addressLine1: "12 Bell Lane",
    addressCity: "Leeds",
    addressPostcode: "LS1 4AB",
  };

  function readiness(token: string, listId?: string) {
    return request(app.getHttpServer())
      .get(listId ? `/recipients/readiness?listId=${listId}` : "/recipients/readiness")
      .set("Authorization", `Bearer ${token}`);
  }

  it("counts everybody, and says how many a card can actually reach", async () => {
    const { token, accountId } = await proAccount();
    await prisma.recipient.createMany({
      data: [
        // Both: a card can reach this one.
        {
          accountId,
          firstName: "Ada",
          lastName: "Reed",
          dateOfBirth: new Date("1990-04-02"),
          ...POSTABLE,
        },
        // A birthday, nowhere to send it.
        { accountId, firstName: "Bram", lastName: "Doyle", dateOfBirth: new Date("1991-05-03") },
        // An address, no idea when.
        { accountId, firstName: "Cleo", lastName: "Nash", ...POSTABLE },
        // Neither.
        { accountId, firstName: "Dot", lastName: "Fry" },
      ],
    });

    const body = contactReadinessSchema.parse((await readiness(token).expect(200)).body);
    expect(body).toEqual({
      total: 4,
      withDateOfBirth: 2,
      withPostalAddress: 2,
      // The number that matters, and the one nobody was being shown.
      sendable: 1,
    });
  });

  it("scopes to a hand-picked list when one is named", async () => {
    const { token, accountId } = await proAccount();
    const inList = await prisma.recipient.create({
      data: {
        accountId,
        firstName: "Ada",
        lastName: "Reed",
        dateOfBirth: new Date("1990-04-02"),
        ...POSTABLE,
      },
    });
    await prisma.recipient.create({
      data: {
        accountId,
        firstName: "Outsider",
        lastName: "Payne",
        dateOfBirth: new Date("1992-01-01"),
        ...POSTABLE,
      },
    });
    const list = await prisma.recipientList.create({ data: { accountId, name: "Year 4" } });
    await prisma.recipientListMembership.create({
      data: { listId: list.id, recipientId: inList.id },
    });

    const scoped = contactReadinessSchema.parse((await readiness(token, list.id).expect(200)).body);
    expect(scoped).toEqual({ total: 1, withDateOfBirth: 1, withPostalAddress: 1, sendable: 1 });

    const everybody = contactReadinessSchema.parse((await readiness(token).expect(200)).body);
    expect(everybody.total).toBe(2);
  });

  it("leaves archived contacts out, because nothing is sent to them", async () => {
    const { token, accountId } = await proAccount();
    await prisma.recipient.create({
      data: {
        accountId,
        firstName: "Gone",
        lastName: "Away",
        dateOfBirth: new Date("1990-04-02"),
        status: "archived",
        ...POSTABLE,
      },
    });

    expect(contactReadinessSchema.parse((await readiness(token).expect(200)).body).total).toBe(0);
  });

  it("keeps one account's contacts out of another's count", async () => {
    const { accountId } = await proAccount();
    await prisma.recipient.create({
      data: {
        accountId,
        firstName: "Ada",
        lastName: "Reed",
        dateOfBirth: new Date("1990-04-02"),
        ...POSTABLE,
      },
    });

    const { token: stranger } = await proAccount();
    expect(contactReadinessSchema.parse((await readiness(stranger).expect(200)).body).total).toBe(
      0,
    );
  });

  it("refuses a list id that is not a list id", async () => {
    const { token } = await proAccount();
    await readiness(token, "not-a-uuid").expect(400);
  });

  it("says how far the balance reaches, in the order the cards go out", async () => {
    const { token, accountId } = await proAccount();
    const recipient = await prisma.recipient.create({
      data: {
        accountId,
        firstName: "Ada",
        lastName: "Reed",
        dateOfBirth: new Date("1990-04-02"),
        ...POSTABLE,
      },
    });
    const design = await prisma.savedDesign.create({
      data: {
        accountId,
        name: "Balloons",
        document: { version: 1, pages: [{ name: "front", elements: [] }] },
      },
    });
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 3);
    const later = new Date();
    later.setUTCDate(later.getUTCDate() + 10);

    for (const dispatchDate of [soon, later]) {
      await prisma.occasion.create({
        data: {
          accountId,
          recipientId: recipient.id,
          type: "birthday",
          source: "recurring_per_recipient",
          occasionDate: dispatchDate,
          dispatchDate,
          dispatchOption: "auto_send",
          status: "approved",
          postageClass: "second_class",
          savedDesignId: design.id,
        },
      });
    }

    const projection = walletProjectionSchema.parse(
      (
        await request(app.getHttpServer())
          .get("/wallet/projection")
          .set("Authorization", `Bearer ${token}`)
          .expect(200)
      ).body,
    );

    // An empty wallet reaches none of them, and the first one it misses is the
    // one going out soonest — which is the sentence the page prints.
    expect(projection.cardsTotal).toBe(2);
    expect(projection.balanceMinor).toBe(0);
    expect(projection.cardsCovered).toBe(0);
    expect(projection.committedMinor).toBeGreaterThan(0);
    expect(projection.firstShortfall?.recipientName).toContain("Ada");
    expect(projection.firstShortfall?.dispatchDate.toISOString().slice(0, 10)).toBe(
      soon.toISOString().slice(0, 10),
    );
  });

  it("counts nothing for an account with nothing committed", async () => {
    const { token } = await proAccount();
    const projection = walletProjectionSchema.parse(
      (
        await request(app.getHttpServer())
          .get("/wallet/projection")
          .set("Authorization", `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    expect(projection).toMatchObject({ cardsTotal: 0, cardsCovered: 0, firstShortfall: null });
  });
});
