import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { CATALOG_SOURCE, type CatalogCardRecord, type CatalogSource } from "../src/catalog/catalog-source";
import { DESIGN_ASSET_STORAGE_CLIENT } from "../src/storage/design-asset-storage.provider";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/** A mock CatalogSource whose returned records tests mutate between syncs. */
let activeCards: CatalogCardRecord[] = [];
const sourceMock: CatalogSource = {
  isConfigured: () => true,
  fetchActiveCards: () => Promise.resolve(activeCards),
};

/** A fake Supabase storage client that records uploads without any network. */
const uploadedPaths: string[] = [];
const storageMock = {
  storage: {
    from: () => ({
      upload: (path: string) => {
        uploadedPaths.push(path);
        return Promise.resolve({ data: { path }, error: null });
      },
      getPublicUrl: (path: string) => ({
        data: { publicUrl: `https://storage.test/design-assets/${path}` },
      }),
    }),
  },
};

function card(overrides: Partial<CatalogCardRecord> & { externalId: string }): CatalogCardRecord {
  return {
    sku: null,
    title: "Untitled",
    category: "birthday",
    frontImage: null,
    insideMessage: null,
    ...overrides,
  };
}

describe("Catalog sync (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    app = await createTestApp([
      { provide: CATALOG_SOURCE, useValue: sourceMock },
      { provide: DESIGN_ASSET_STORAGE_CLIENT, useValue: storageMock },
    ]);
    prisma = app.get(PrismaService);

    // Stub the artwork download so copyImage never touches the network.
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
      headers: { get: () => "image/png" },
    } as unknown as Response);
  });

  afterAll(async () => {
    fetchSpy.mockRestore();
    // Clean up synced cards so other e2e files aren't affected.
    await prisma.cardDesign.deleteMany({ where: { externalId: { not: null } } });
    await app.close();
  });

  beforeEach(() => {
    activeCards = [];
    uploadedPaths.length = 0;
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

  it("rejects a non-admin from syncing", async () => {
    const token = await customerToken();
    await request(app.getHttpServer())
      .post("/catalog/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });

  it("reports Airtable as configured via the mock source", async () => {
    const token = await opsToken();
    await request(app.getHttpServer())
      .get("/catalog/status")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect({ configured: true });
  });

  it("creates card designs from Airtable, copying artwork into our storage", async () => {
    const externalId = `rec${randomUUID().slice(0, 14)}`;
    activeCards = [
      card({
        externalId,
        sku: "KC-BDAY-GEN-999",
        title: "Sync Test Balloons",
        category: "birthday", // the source normalises casing; the mock supplies it already normalised
        frontImage: { url: "https://airtable.test/art.png", filename: "art.png", contentType: "image/png" },
        insideMessage: "Well done!",
      }),
    ];

    const token = await opsToken();
    const response = await request(app.getHttpServer())
      .post("/catalog/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(response.body).toMatchObject({ fetched: 1, created: 1, updated: 0, imagesCopied: 1 });
    expect(uploadedPaths).toEqual([`catalog/${externalId}.png`]);

    const design = await prisma.cardDesign.findUnique({ where: { externalId } });
    expect(design).not.toBeNull();
    expect(design).toMatchObject({
      name: "Sync Test Balloons",
      sku: "KC-BDAY-GEN-999",
      category: "birthday",
      isActive: true,
      thumbnailUrl: `https://storage.test/design-assets/catalog/${externalId}.png`,
    });
    // Artwork embedded as a full-bleed background image on the front page.
    const front = (design!.document as { pages: { name: string; elements: unknown[] }[] }).pages.find(
      (p) => p.name === "front",
    );
    expect(front!.elements[0]).toMatchObject({
      kind: "image",
      assetUrl: `https://storage.test/design-assets/catalog/${externalId}.png`,
    });
    // A real inside message seeds an editable text block on the inside-right page.
    const insideRight = (design!.document as { pages: { name: string; elements: unknown[] }[] }).pages.find(
      (p) => p.name === "inside-right",
    );
    expect(insideRight!.elements[0]).toMatchObject({ kind: "text", text: "Well done!" });
  });

  it("updates an existing design in place on re-sync (no duplicate)", async () => {
    const externalId = `rec${randomUUID().slice(0, 14)}`;
    activeCards = [card({ externalId, title: "First Title" })];
    const token = await opsToken();

    await request(app.getHttpServer())
      .post("/catalog/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    activeCards = [card({ externalId, title: "Renamed Title" })];
    const second = await request(app.getHttpServer())
      .post("/catalog/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(second.body).toMatchObject({ created: 0, updated: 1 });
    const rows = await prisma.cardDesign.findMany({ where: { externalId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("Renamed Title");
  });

  it("deactivates a card that is no longer active upstream, leaving seeded templates alone", async () => {
    const keptId = `rec${randomUUID().slice(0, 14)}`;
    const retiredId = `rec${randomUUID().slice(0, 14)}`;
    const token = await opsToken();

    activeCards = [card({ externalId: keptId, title: "Kept" }), card({ externalId: retiredId, title: "Retired" })];
    await request(app.getHttpServer())
      .post("/catalog/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    // Seeded templates have external_id = null and must survive a sync.
    const seededActiveBefore = await prisma.cardDesign.count({
      where: { externalId: null, isActive: true },
    });

    activeCards = [card({ externalId: keptId, title: "Kept" })];
    const response = await request(app.getHttpServer())
      .post("/catalog/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(response.body).toMatchObject({ deactivated: 1 });
    expect((await prisma.cardDesign.findUnique({ where: { externalId: retiredId } }))!.isActive).toBe(false);
    expect((await prisma.cardDesign.findUnique({ where: { externalId: keptId } }))!.isActive).toBe(true);
    expect(await prisma.cardDesign.count({ where: { externalId: null, isActive: true } })).toBe(
      seededActiveBefore,
    );
  });

  it("does not deactivate anything when the fetch returns no cards", async () => {
    const externalId = `rec${randomUUID().slice(0, 14)}`;
    const token = await opsToken();
    activeCards = [card({ externalId, title: "Still Here" })];
    await request(app.getHttpServer())
      .post("/catalog/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    activeCards = [];
    const response = await request(app.getHttpServer())
      .post("/catalog/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(response.body).toMatchObject({ fetched: 0, deactivated: 0 });
    expect((await prisma.cardDesign.findUnique({ where: { externalId } }))!.isActive).toBe(true);
  });
});
