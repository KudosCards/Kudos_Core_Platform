import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * The send-by-5 reminder config endpoints (ADR 0117): read/update the runtime
 * knobs, validation, and ops-only auth. Runs against the real test DB via the
 * PlatformSetting store — no external services.
 */
describe("Dispatch reminder config (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function opsToken(): Promise<string> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId } });
    return mintToken(userId);
  }

  async function customerToken(): Promise<string> {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Test Centre ${randomUUID()}` })
      .expect(201);
    return token;
  }

  it("returns the config + default, and persists an update", async () => {
    const token = await opsToken();

    const initial = await request(app.getHttpServer())
      .get("/admin/dispatch/reminder-config")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const body = initial.body as {
      config: { enabled: boolean; leadWorkingDays: number };
      default: { leadWorkingDays: number };
    };
    expect(body.default.leadWorkingDays).toBe(5);

    const updated = await request(app.getHttpServer())
      .put("/admin/dispatch/reminder-config")
      .set("Authorization", `Bearer ${token}`)
      .send({
        enabled: false,
        sendHourUtc: 9,
        leadWorkingDays: 7,
        escalateAfterWorkingDays: 2,
        sameDayCutoffHour: 16,
      })
      .expect(200);
    expect((updated.body as { config: { sendHourUtc: number } }).config.sendHourUtc).toBe(9);

    // The change is persisted and read back.
    const reread = await request(app.getHttpServer())
      .get("/admin/dispatch/reminder-config")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(
      (reread.body as { config: { enabled: boolean; leadWorkingDays: number } }).config,
    ).toMatchObject({
      enabled: false,
      leadWorkingDays: 7,
    });
  });

  it("rejects an out-of-range value", async () => {
    const token = await opsToken();
    await request(app.getHttpServer())
      .put("/admin/dispatch/reminder-config")
      .set("Authorization", `Bearer ${token}`)
      .send({
        enabled: true,
        sendHourUtc: 25,
        leadWorkingDays: 5,
        escalateAfterWorkingDays: 3,
        sameDayCutoffHour: 15,
      })
      .expect(400);
  });

  it("requires platform-admin auth", async () => {
    const token = await customerToken();
    await request(app.getHttpServer())
      .get("/admin/dispatch/reminder-config")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });
});
