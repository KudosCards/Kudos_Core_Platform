import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema, inboxPageSchema, notificationFeedSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

describe("Notifications feed (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function signUp(): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID());
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Test Centre ${randomUUID()}` })
      .expect(201);
    return { token, accountId: accountSchema.parse(response.body).id };
  }

  function feed(token: string) {
    return request(app.getHttpServer())
      .get("/notifications")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
  }

  it("returns an empty feed for a brand-new account", async () => {
    const { token } = await signUp();
    const parsed = notificationFeedSchema.parse((await feed(token)).body);
    expect(parsed.items).toEqual([]);
  });

  it("surfaces pending approvals, upcoming occasions, and unpaid orders", async () => {
    const { token, accountId } = await signUp();

    const recipient = await prisma.recipient.create({
      data: { accountId, firstName: "Ada", lastName: "Lovelace" },
    });

    // A pending-approval occasion.
    await prisma.occasion.create({
      data: {
        accountId,
        recipientId: recipient.id,
        type: "birthday",
        source: "recurring_per_recipient",
        occasionDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        status: "pending_approval",
      },
    });
    // An approved occasion coming up in the window → upcoming.
    await prisma.occasion.create({
      data: {
        accountId,
        recipientId: recipient.id,
        type: "birthday",
        source: "recurring_per_recipient",
        occasionDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        status: "approved",
      },
    });
    // An approved occasion far in the future → NOT upcoming.
    await prisma.occasion.create({
      data: {
        accountId,
        recipientId: recipient.id,
        type: "achievement",
        source: "one_off_campaign",
        occasionDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
        status: "approved",
      },
    });
    // A draft order → unpaid.
    await prisma.batchOrder.create({ data: { accountId, status: "draft" } });

    const parsed = notificationFeedSchema.parse((await feed(token)).body);
    const kinds = parsed.items.map((i) => i.kind);

    expect(kinds).toContain("pending_approval");
    expect(kinds).toContain("unpaid_order");
    // Exactly one upcoming (the 5-day one; the 90-day one is out of window).
    const upcoming = parsed.items.filter((i) => i.kind === "upcoming_occasion");
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0]?.title).toContain("Ada Lovelace");
    expect(upcoming[0]?.href).toBe("/calendar");
    // Actionable items come before the informational upcoming events.
    expect(kinds.indexOf("pending_approval")).toBeLessThan(kinds.indexOf("upcoming_occasion"));
  });

  it("shows pending team invites only to owners/admins", async () => {
    const { token, accountId } = await signUp();
    await prisma.invite.create({
      data: {
        accountId,
        email: "invitee@centre.test",
        role: "staff",
        token: randomUUID(),
        status: "pending",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // The owner sees the invite reminder.
    const ownerFeed = notificationFeedSchema.parse((await feed(token)).body);
    expect(ownerFeed.items.some((i) => i.kind === "pending_invite")).toBe(true);

    // A staff member on the same account does not.
    const staffUserId = randomUUID();
    await prisma.membership.create({
      data: { accountId, userId: staffUserId, role: "staff", email: "s@centre.test" },
    });
    const staffToken = await mintToken(staffUserId, "s@centre.test");
    const staffFeed = notificationFeedSchema.parse((await feed(staffToken)).body);
    expect(staffFeed.items.some((i) => i.kind === "pending_invite")).toBe(false);
  });

  describe("persisted inbox", () => {
    /** The owner user id for an account (the membership POST /accounts created). */
    async function ownerUserId(accountId: string): Promise<string> {
      const membership = await prisma.membership.findFirstOrThrow({ where: { accountId } });
      return membership.userId;
    }

    function inbox(token: string) {
      return request(app.getHttpServer())
        .get("/notifications/inbox")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
    }

    it("lists a member's notifications newest-first with an unread count, and marks them read", async () => {
      const { token, accountId } = await signUp();
      const userId = await ownerUserId(accountId);

      await prisma.notification.create({
        data: {
          accountId,
          userId,
          kind: "order_paid",
          title: "Order ORD-1 is paid",
          body: "1 card is now in production.",
          href: "/orders/x",
          createdAt: new Date(Date.now() - 60_000),
        },
      });
      await prisma.notification.create({
        data: {
          accountId,
          userId,
          kind: "auto_send",
          title: "A card was sent to Ada Lovelace",
          body: "Their birthday card was ordered and posted automatically.",
        },
      });

      const page = inboxPageSchema.parse((await inbox(token)).body);
      expect(page.total).toBe(2);
      expect(page.unreadCount).toBe(2);
      // Newest first: the auto_send (no explicit createdAt) is newer than the order.
      expect(page.items[0]?.kind).toBe("auto_send");
      expect(page.items[1]?.kind).toBe("order_paid");

      // The cheap badge endpoint agrees.
      const count = await request(app.getHttpServer())
        .get("/notifications/inbox/unread-count")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      expect(count.body).toEqual({ unreadCount: 2 });

      // Mark the first read → unread drops to 1.
      await request(app.getHttpServer())
        .post(`/notifications/inbox/${page.items[0]!.id}/read`)
        .set("Authorization", `Bearer ${token}`)
        .expect(201);
      const afterOne = inboxPageSchema.parse((await inbox(token)).body);
      expect(afterOne.unreadCount).toBe(1);
      expect(afterOne.items.find((i) => i.id === page.items[0]!.id)?.readAt).not.toBeNull();

      // Mark all read → unread 0.
      await request(app.getHttpServer())
        .post("/notifications/inbox/read-all")
        .set("Authorization", `Bearer ${token}`)
        .expect(201);
      const afterAll = inboxPageSchema.parse((await inbox(token)).body);
      expect(afterAll.unreadCount).toBe(0);
    });

    it("scopes the inbox to the individual member — one member can't see another's rows", async () => {
      const { token, accountId } = await signUp();
      const ownerId = await ownerUserId(accountId);

      // A staff member on the same account, and a notification for the owner only.
      const staffUserId = randomUUID();
      await prisma.membership.create({
        data: { accountId, userId: staffUserId, role: "staff", email: "staff@centre.test" },
      });
      await prisma.notification.create({
        data: { accountId, userId: ownerId, kind: "order_paid", title: "Owner only", body: "…" },
      });

      // The staff member's inbox is empty; the owner's has the row.
      const staffToken = await mintToken(staffUserId, "staff@centre.test");
      const staffPage = inboxPageSchema.parse((await inbox(staffToken)).body);
      expect(staffPage.total).toBe(0);

      const ownerPage = inboxPageSchema.parse((await inbox(token)).body);
      expect(ownerPage.total).toBe(1);

      // A member can't mark another member's notification read (updateMany scoped
      // to their userId, so it's a silent no-op — the owner's stays unread).
      const ownerRowId = ownerPage.items[0]!.id;
      await request(app.getHttpServer())
        .post(`/notifications/inbox/${ownerRowId}/read`)
        .set("Authorization", `Bearer ${staffToken}`)
        .expect(201);
      const ownerAfter = inboxPageSchema.parse((await inbox(token)).body);
      expect(ownerAfter.unreadCount).toBe(1);
    });
  });
});
