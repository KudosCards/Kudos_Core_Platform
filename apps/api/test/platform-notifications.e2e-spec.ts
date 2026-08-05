import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { PlatformNotificationService } from "../src/platform-notifications/platform-notification.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * The Kudos HQ ops notification centre (ADR 0116): per-operator inbox with
 * read/unread, plus the platform-wide fan-out producer's idempotency. Runs
 * against the real test DB — no external services involved.
 */
describe("Platform notifications (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let service: PlatformNotificationService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    service = app.get(PlatformNotificationService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createOpsAdmin(): Promise<{ token: string; userId: string }> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId } });
    return { token: await mintToken(userId), userId };
  }

  async function signUpCustomer(): Promise<string> {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Test Centre ${randomUUID()}` })
      .expect(201);
    return token;
  }

  it("lists an operator's inbox with unread count, and marks read", async () => {
    const { token, userId } = await createOpsAdmin();
    const created = await prisma.platformNotification.create({
      data: {
        userId,
        kind: "dispatch_reminder",
        title: "3 cards overdue to post",
        body: "3 overdue · 1 due today · 4 within 5 working days",
        href: "/fulfillment",
      },
    });

    const unread = await request(app.getHttpServer())
      .get("/admin/notifications/unread-count")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect((unread.body as { unreadCount: number }).unreadCount).toBe(1);

    const list = await request(app.getHttpServer())
      .get("/admin/notifications")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const body = list.body as { items: { id: string }[]; unreadCount: number; total: number };
    expect(body.items.map((i) => i.id)).toContain(created.id);
    expect(body.unreadCount).toBe(1);

    await request(app.getHttpServer())
      .post(`/admin/notifications/${created.id}/read`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    const after = await request(app.getHttpServer())
      .get("/admin/notifications/unread-count")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect((after.body as { unreadCount: number }).unreadCount).toBe(0);
  });

  it("fans out one row per operator and is idempotent on (kind, entityId)", async () => {
    const a = await createOpsAdmin();
    const b = await createOpsAdmin();
    const entityId = `test-${randomUUID()}`;
    const payload = {
      kind: "dispatch_reminder",
      title: "Cards to post",
      body: "…",
      entityType: "dispatch_reminder",
      entityId,
    };

    await service.notifyAllAdmins(payload);
    // A second identical run must not double-notify.
    await service.notifyAllAdmins(payload);

    const countA = await prisma.platformNotification.count({
      where: { userId: a.userId, kind: "dispatch_reminder", entityId },
    });
    const countB = await prisma.platformNotification.count({
      where: { userId: b.userId, kind: "dispatch_reminder", entityId },
    });
    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });

  it("requires platform-admin auth (a normal customer is refused)", async () => {
    const token = await signUpCustomer();
    await request(app.getHttpServer())
      .get("/admin/notifications")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });
});
