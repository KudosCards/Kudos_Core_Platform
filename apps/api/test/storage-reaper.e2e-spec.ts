import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { accountSchema } from "@kudos/shared-types";
import { PrismaService } from "../src/prisma/prisma.service";
import { DESIGN_ASSET_STORAGE_CLIENT } from "../src/storage/design-asset-storage.provider";
import {
  REAPER_PAGE_SIZE,
  type ReapSummary,
} from "../src/storage-maintenance/storage-reaper.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

// Opt the reaper in for this file, before the app validates env at boot, so the
// enabled delete path is exercised end-to-end. Restored in afterAll.
const priorEnabled = process.env.STORAGE_REAPER_ENABLED;
process.env.STORAGE_REAPER_ENABLED = "true";

const OLD = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const publicUrl = (path: string) =>
  `https://x.supabase.co/storage/v1/object/public/design-assets/${path}`;

/** Seeded storage objects the mock serves through the folder-walk `list` API. */
let storageObjects: { path: string; createdAt: string | null }[] = [];
const removedPaths: string[] = [];

const storageMock = {
  storage: {
    from: () => ({
      list: (prefix: string) => {
        if (prefix === "") {
          const dirs = new Set<string>();
          for (const o of storageObjects) {
            const slash = o.path.indexOf("/");
            if (slash !== -1) dirs.add(o.path.slice(0, slash));
          }
          return Promise.resolve({
            data: [...dirs].map((name) => ({ name, id: null, created_at: null })),
            error: null,
          });
        }
        const inside = storageObjects
          .filter((o) => o.path.startsWith(`${prefix}/`))
          .map((o) => ({
            name: o.path.slice(prefix.length + 1),
            id: "file-id",
            created_at: o.createdAt,
          }));
        return Promise.resolve({ data: inside, error: null });
      },
      remove: (paths: string[]) => {
        removedPaths.push(...paths);
        return Promise.resolve({ data: paths.map((p) => ({ name: p })), error: null });
      },
    }),
  },
};

describe("Storage reaper (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp([{ provide: DESIGN_ASSET_STORAGE_CLIENT, useValue: storageMock }]);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    if (priorEnabled === undefined) delete process.env.STORAGE_REAPER_ENABLED;
    else process.env.STORAGE_REAPER_ENABLED = priorEnabled;
  });

  beforeEach(() => {
    storageObjects = [];
    removedPaths.length = 0;
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
      .send({ type: "organisation", name: `Centre ${randomUUID()}` })
      .expect(201)
      .expect((res) => accountSchema.parse(res.body));
    return token;
  }

  it("rejects a non-admin from reaping", async () => {
    const token = await customerToken();
    await request(app.getHttpServer())
      .post("/storage-maintenance/reap")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });

  it("reports the enabled status to an operator, and 403s a customer", async () => {
    const customer = await customerToken();
    await request(app.getHttpServer())
      .get("/storage-maintenance/status")
      .set("Authorization", `Bearer ${customer}`)
      .expect(403);

    const ops = await opsToken();
    await request(app.getHttpServer())
      .get("/storage-maintenance/status")
      .set("Authorization", `Bearer ${ops}`)
      .expect(200)
      // STORAGE_REAPER_ENABLED is set "true" for this file (see top).
      .expect({ enabled: true });
  });

  it("deletes the orphan and keeps the referenced object (real Prisma)", async () => {
    const account = await prisma.account.create({
      data: { type: "organisation", name: `Centre ${randomUUID()}` },
    });
    const kept = `${account.id}/kept.png`;
    const orphan = `${account.id}/orphan.png`;
    await prisma.designAsset.create({
      data: { accountId: account.id, url: publicUrl(kept), fileName: "kept.png" },
    });
    storageObjects = [
      { path: kept, createdAt: OLD },
      { path: orphan, createdAt: OLD },
    ];

    const token = await opsToken();
    const res = await request(app.getHttpServer())
      .post("/storage-maintenance/reap?dryRun=false")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    const summary = res.body as ReapSummary;
    expect(summary.deleted).toBe(1);
    expect(summary.dryRun).toBe(false);
    expect(removedPaths).toEqual([orphan]);
  });

  it("keeps a referenced object recorded beyond the first page of designs", async () => {
    // The reaper deletes storage objects, so a row it fails to read is a live
    // asset deleted. It read every DesignAsset, CardDesign and SavedDesign on
    // the platform in one unbounded query each — two of them pulling whole JSON
    // documents — which is what made paging necessary; paging is only safe if
    // nothing on a later page is missed.
    const account = await prisma.account.create({
      data: { type: "organisation", name: `Centre ${randomUUID()}` },
    });
    const referenced = `${account.id}/on-a-later-page.png`;

    // Ids are assigned explicitly so the ordering is not left to chance: the
    // scan pages by primary key, and with random uuids the row "after the first
    // page" lands wherever it happens to sort. The filler sorts lowest, the
    // asset that matters sorts last of everything in the table — so if paging
    // stops early, loses its place, or reads unordered, this row is the one it
    // misses.
    await prisma.designAsset.createMany({
      data: Array.from({ length: REAPER_PAGE_SIZE }, (_, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        accountId: account.id,
        url: publicUrl(`${account.id}/filler-${i}.png`),
        fileName: `filler-${i}.png`,
      })),
    });
    await prisma.designAsset.create({
      data: {
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        accountId: account.id,
        url: publicUrl(referenced),
        fileName: "on-a-later-page.png",
      },
    });

    storageObjects = [{ path: referenced, createdAt: OLD }];

    const token = await opsToken();
    const res = await request(app.getHttpServer())
      .post("/storage-maintenance/reap?dryRun=false")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect((res.body as ReapSummary).deleted).toBe(0);
    expect(removedPaths).toEqual([]);
  });

  it("defaults to a dry run that deletes nothing", async () => {
    const account = await prisma.account.create({
      data: { type: "organisation", name: `Centre ${randomUUID()}` },
    });
    const orphan = `${account.id}/orphan.png`;
    storageObjects = [{ path: orphan, createdAt: OLD }];

    const token = await opsToken();
    const res = await request(app.getHttpServer())
      .post("/storage-maintenance/reap")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    const summary = res.body as ReapSummary;
    expect(summary.orphaned).toBeGreaterThanOrEqual(1);
    expect(summary.deleted).toBe(0);
    expect(summary.dryRun).toBe(true);
    expect(removedPaths).toEqual([]);
  });
});
