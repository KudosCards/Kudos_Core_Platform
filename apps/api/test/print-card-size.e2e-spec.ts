import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * The default print card size endpoints (ADR 0138): read/update the A5/A6
 * default the fulfilment print run opens on, validation, and ops-only auth.
 * Runs against the real test DB via the PlatformSetting store — no external
 * services.
 */
describe("Print card size config (e2e)", () => {
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
    // Changing this is a platform setting, so it is super-admin only
    // (ADR 0040/0187). The role used to be omitted, which defaults to `ops` —
    // so this suite passed against a route that should have refused it.
    await prisma.platformAdmin.create({ data: { userId, role: "super_admin" } });
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

  it("returns the size + house default, and persists an update", async () => {
    const token = await opsToken();

    // The house default is always A6, regardless of what's stored (the store is
    // global and persists across runs, so we assert the round-trip, not the
    // pre-existing value).
    const initial = await request(app.getHttpServer())
      .get("/admin/print/card-size")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect((initial.body as { default: string }).default).toBe("A6");

    const updated = await request(app.getHttpServer())
      .put("/admin/print/card-size")
      .set("Authorization", `Bearer ${token}`)
      .send({ size: "A5" })
      .expect(200);
    expect((updated.body as { size: string }).size).toBe("A5");

    // The change is persisted and read back; the house default is unchanged.
    const reread = await request(app.getHttpServer())
      .get("/admin/print/card-size")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(reread.body).toMatchObject({ size: "A5", default: "A6" });

    // And it can be set back to A6, so the round-trip works both ways.
    await request(app.getHttpServer())
      .put("/admin/print/card-size")
      .set("Authorization", `Bearer ${token}`)
      .send({ size: "A6" })
      .expect(200);
    const final = await request(app.getHttpServer())
      .get("/admin/print/card-size")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect((final.body as { size: string }).size).toBe("A6");
  });

  it("rejects an unknown size", async () => {
    const token = await opsToken();
    await request(app.getHttpServer())
      .put("/admin/print/card-size")
      .set("Authorization", `Bearer ${token}`)
      .send({ size: "A4" })
      .expect(400);
  });

  it("requires platform-admin auth", async () => {
    const token = await customerToken();
    await request(app.getHttpServer())
      .get("/admin/print/card-size")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });
});
