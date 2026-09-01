import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { BULK_APPROVE_MAX, type BulkApproveResult } from "@kudos/shared-types";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * Approving a whole selection with one design.
 *
 * Approving is where a card's design is chosen, so it was one occasion at a
 * time: "send this card to these thirty pupils, each on their birthday" was
 * thirty separate acts. See ADR 0219.
 *
 * The interesting cases are not the happy path. They are the ones where part of
 * a selection cannot be approved — an address missing for auto-send, an occasion
 * someone else actioned while the screen sat open, an id from another account —
 * because a bulk action that abandons the batch on the first of those is the
 * defect ADR 0186 named.
 */
describe("Bulk approve (e2e)", () => {
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
      .send({ type: "organisation", name: `Bulk co ${randomUUID()}` })
      .expect(201);
    return { token, accountId: (created.body as { id: string }).id };
  }

  async function savedDesign(token: string): Promise<string> {
    const templates = await request(app.getHttpServer())
      .get("/card-designs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const cardDesignId = (templates.body as { id: string }[])[0]!.id;
    const response = await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({ cardDesignId, name: `Design ${randomUUID().slice(0, 8)}` })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  /** A pending birthday. `addressed: false` leaves the contact without a postal
   * address, which is what auto-send refuses. */
  async function pending(
    accountId: string,
    firstName: string,
    { addressed = true }: { addressed?: boolean } = {},
  ): Promise<string> {
    const recipient = await prisma.recipient.create({
      data: {
        accountId,
        firstName,
        lastName: `Pupil ${randomUUID().slice(0, 8)}`,
        ...(addressed
          ? { addressLine1: "1 Test Street", addressCity: "London", addressPostcode: "SW1A 1AA" }
          : {}),
      },
    });
    const occasion = await prisma.occasion.create({
      data: {
        accountId,
        recipientId: recipient.id,
        type: "birthday",
        source: "recurring_per_recipient",
        occasionDate: utcDay(14),
        status: "pending_approval",
      },
    });
    return occasion.id;
  }

  function bulkApprove(token: string, body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post("/occasions/approve-bulk")
      .set("Authorization", `Bearer ${token}`)
      .send(body);
  }

  const occasionRow = (id: string) => prisma.occasion.findUniqueOrThrow({ where: { id } });

  it("approves a whole selection with one design", async () => {
    const { token, accountId } = await account();
    const design = await savedDesign(token);
    const ids = [
      await pending(accountId, "Ada"),
      await pending(accountId, "Grace"),
      await pending(accountId, "Alan"),
    ];

    const response = await bulkApprove(token, {
      occasionIds: ids,
      savedDesignId: design,
    }).expect(201);
    const body = response.body as BulkApproveResult;

    expect(body.approvedIds.sort()).toEqual([...ids].sort());
    expect(body.failed).toEqual([]);
    for (const id of ids) {
      const row = await occasionRow(id);
      expect(row.status).toBe("approved");
      expect(row.savedDesignId).toBe(design);
      // Each still posts on its own date — that is what separates this from
      // /send, which posts one-off cards now.
      expect(row.dispatchOption).toBe("asap");
    }
  });

  it("approves the rest when one contact has no address for auto-send", async () => {
    const { token, accountId } = await account();
    // Move this account onto a plan that already permits auto-send, rather than
    // flipping the shared `free` entitlement — accounts.e2e-spec asserts a new
    // account has autoSendEnabled false, and a test that edits seed data other
    // tests read is a flake waiting for an unlucky file order.
    await prisma.account.update({ where: { id: accountId }, data: { planId: "pro" } });
    const design = await savedDesign(token);
    const good = await pending(accountId, "Addressed");
    const bad = await pending(accountId, "Homeless", { addressed: false });

    const response = await bulkApprove(token, {
      occasionIds: [good, bad],
      savedDesignId: design,
      dispatchOption: "auto_send",
    }).expect(201);
    const body = response.body as BulkApproveResult;

    expect(body.approvedIds).toEqual([good]);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0]!.occasionId).toBe(bad);
    // Named, not counted: "1 failed" gives the reader nothing to act on.
    expect(body.failed[0]!.recipientName).toContain("Homeless");
    expect(body.failed[0]!.reason).toMatch(/address/i);

    expect((await occasionRow(good)).status).toBe("approved");
    expect((await occasionRow(bad)).status).toBe("pending_approval");
  });

  it("reports an occasion that is no longer pending, and approves the others", async () => {
    const { token, accountId } = await account();
    const design = await savedDesign(token);
    const live = await pending(accountId, "Live");
    const gone = await pending(accountId, "Skipped");
    await request(app.getHttpServer())
      .post(`/occasions/${gone}/skip`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    const response = await bulkApprove(token, {
      occasionIds: [live, gone],
      savedDesignId: design,
    }).expect(201);
    const body = response.body as BulkApproveResult;

    expect(body.approvedIds).toEqual([live]);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0]!.reason).toMatch(/skipped/i);
    expect((await occasionRow(gone)).status).toBe("skipped");
  });

  it("never approves another account's occasion", async () => {
    const mine = await account();
    const theirs = await account();
    const design = await savedDesign(mine.token);
    const myOccasion = await pending(mine.accountId, "Mine");
    const theirOccasion = await pending(theirs.accountId, "Theirs");

    const response = await bulkApprove(mine.token, {
      occasionIds: [myOccasion, theirOccasion],
      savedDesignId: design,
    }).expect(201);
    const body = response.body as BulkApproveResult;

    expect(body.approvedIds).toEqual([myOccasion]);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0]!.occasionId).toBe(theirOccasion);
    // Reported as absent rather than as anything about the other account.
    expect(body.failed[0]!.recipientName).toBeNull();
    expect((await occasionRow(theirOccasion)).status).toBe("pending_approval");
  });

  it("rejects a design that is not this account's, without approving anything", async () => {
    const mine = await account();
    const theirs = await account();
    const theirDesign = await savedDesign(theirs.token);
    const myOccasion = await pending(mine.accountId, "Untouched");

    await bulkApprove(mine.token, {
      occasionIds: [myOccasion],
      savedDesignId: theirDesign,
    }).expect(404);

    expect((await occasionRow(myOccasion)).status).toBe("pending_approval");
  });

  it("approves a repeated id once", async () => {
    const { token, accountId } = await account();
    const design = await savedDesign(token);
    const id = await pending(accountId, "Twice");

    const response = await bulkApprove(token, {
      occasionIds: [id, id],
      savedDesignId: design,
    }).expect(201);
    const body = response.body as BulkApproveResult;

    // Deduped up front, so the second copy is not a "no longer pending" failure
    // caused by the first copy having just approved it.
    expect(body.approvedIds).toEqual([id]);
    expect(body.failed).toEqual([]);
  });

  it("refuses a selection larger than the page can offer", async () => {
    const { token, accountId } = await account();
    const design = await savedDesign(token);
    const one = await pending(accountId, "Only");

    await bulkApprove(token, {
      occasionIds: [one, ...Array.from({ length: BULK_APPROVE_MAX }, () => randomUUID())],
      savedDesignId: design,
    }).expect(400);

    expect((await occasionRow(one)).status).toBe("pending_approval");
  });

  it("refuses an empty selection", async () => {
    const { token } = await account();
    const design = await savedDesign(token);
    await bulkApprove(token, { occasionIds: [], savedDesignId: design }).expect(400);
  });
});
