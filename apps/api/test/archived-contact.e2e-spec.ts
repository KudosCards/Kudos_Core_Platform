import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema, navBadgesSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * What archiving a contact is supposed to mean.
 *
 * There is no way to delete a contact — archiving is the only way to stop
 * sending to somebody. The rule is already written down, in the promoter that
 * fills the approvals queue: "Don't pull an archived recipient's occasion into
 * the approvals queue."
 *
 * The queue itself obeys it. Everything that *counts* the queue did not, so the
 * sidebar said three while the page said none; and auto-send did not either, so
 * a card already approved was still printed and posted to somebody the customer
 * had archived. See ADR 0266.
 */

describe("An archived contact (e2e)", () => {
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
      .send({ type: "organisation", name: `Centre ${randomUUID()}` })
      .expect(201);
    const accountId = accountSchema.parse(response.body).id;
    await prisma.account.update({ where: { id: accountId }, data: { planId: "pro" } });
    return { token, accountId };
  }

  async function createRecipient(token: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Izobella",
        lastName: "Ross",
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
      })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  async function createSavedDesign(token: string): Promise<string> {
    const templates = await request(app.getHttpServer())
      .get("/card-designs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const cardDesignId = (templates.body as { id: string }[])[0]!.id;
    const response = await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({ cardDesignId, name: "Auto design" })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  async function createOccasion(token: string, recipientId: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "achievement", occasionDate: todayIso(), recipientId })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  function archive(token: string, recipientId: string) {
    return request(app.getHttpServer())
      .delete(`/recipients/${recipientId}`)
      .set("Authorization", `Bearer ${token}`);
  }

  async function badges(token: string) {
    const response = await request(app.getHttpServer())
      .get("/accounts/me/nav-badges")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    return navBadgesSchema.parse(response.body);
  }

  async function pendingOnThePage(token: string): Promise<number> {
    const response = await request(app.getHttpServer())
      .get("/occasions?status=pending_approval&perPage=100")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    return (response.body as { total: number }).total;
  }

  it("is not counted by a badge the approvals page cannot explain", async () => {
    // The reported bug: three on the sidebar, nothing on the page. The counts
    // and the queue have to answer the same question.
    const { token } = await proAccount();
    const recipientId = await createRecipient(token);
    await createOccasion(token, recipientId);

    expect((await badges(token)).pendingApprovals).toBe(1);
    expect(await pendingOnThePage(token)).toBe(1);

    const archived = await archive(token, recipientId);
    expect([200, 204]).toContain(archived.status);

    expect(await pendingOnThePage(token)).toBe(0);
    expect((await badges(token)).pendingApprovals).toBe(0);
  });

  it("comes back with their occasions when they are restored", async () => {
    // Archiving hides; it does not destroy. The count has to follow it back.
    const { token } = await proAccount();
    const recipientId = await createRecipient(token);
    await createOccasion(token, recipientId);
    await archive(token, recipientId);
    expect((await badges(token)).pendingApprovals).toBe(0);

    await request(app.getHttpServer())
      .patch(`/recipients/${recipientId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "active" })
      .expect(200);

    expect((await badges(token)).pendingApprovals).toBe(1);
    expect(await pendingOnThePage(token)).toBe(1);
  });

  it("is not counted on the dashboard either", async () => {
    const { token } = await proAccount();
    const recipientId = await createRecipient(token);
    await createOccasion(token, recipientId);
    await archive(token, recipientId);

    const summary = await request(app.getHttpServer())
      .get("/accounts/me/summary")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect((summary.body as { pendingApprovals: number }).pendingApprovals).toBe(0);
  });

  it("is not counted by the notification bell either", async () => {
    const { token } = await proAccount();
    const recipientId = await createRecipient(token);
    await createOccasion(token, recipientId);
    await archive(token, recipientId);

    const feed = await request(app.getHttpServer())
      .get("/notifications")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const body = feed.body as { items: { title: string }[] };
    expect(body.items.filter((item) => /need|approval/i.test(item.title))).toHaveLength(0);
  });

  it("does not get a card auto-send has already been told to post", async () => {
    // The serious one. Archiving is the only way to stop sending to somebody,
    // and a card approved before the archive was still printed, paid for and
    // posted to them.
    const { token, accountId } = await proAccount();
    // Funded on purpose. Without this the card is skipped for want of money and
    // the test passes while proving nothing — which is exactly what the first
    // version of it did.
    await prisma.walletLedgerEntry.create({
      data: {
        accountId,
        type: "topup",
        amountMinor: 5000,
        balanceAfterMinor: 5000,
        reference: "archived-contact e2e",
      },
    });
    const recipientId = await createRecipient(token);
    const savedDesignId = await createSavedDesign(token);
    const occasionId = await createOccasion(token, recipientId);
    await request(app.getHttpServer())
      .post(`/occasions/${occasionId}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ savedDesignId, dispatchOption: "auto_send" })
      .expect(201);

    await archive(token, recipientId);

    const opsUserId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId: opsUserId } });
    const ops = await mintToken(opsUserId);
    await request(app.getHttpServer())
      .post("/auto-send/run")
      .set("Authorization", `Bearer ${ops}`)
      .expect(201);

    const occasion = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
    expect(occasion.status).not.toBe("queued");
    expect(await prisma.batchOrder.count({ where: { accountId } })).toBe(0);
    // And the money is where it was: a card that is not sent is not paid for.
    const spent = await prisma.walletLedgerEntry.aggregate({
      where: { accountId },
      _sum: { amountMinor: true },
    });
    expect(spent._sum.amountMinor).toBe(5000);
  });
});
