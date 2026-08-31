import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  CATALOG_SOURCE,
  type CatalogCardRecord,
  type CatalogSource,
} from "../src/catalog/catalog-source";
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
/** Set by a test to make the next upload(s) fail, as the bucket's mime/size
 *  limits do in production. */
let uploadError: string | null = null;
const createdBuckets: string[] = [];
const storageMock = {
  storage: {
    createBucket: (name: string) => {
      createdBuckets.push(name);
      return Promise.resolve({ data: { name }, error: null });
    },
    updateBucket: () => Promise.resolve({ data: null, error: null }),
    from: () => ({
      upload: (path: string) => {
        uploadedPaths.push(path);
        if (uploadError) {
          // What Supabase returns for a mime the bucket doesn't allow, or a
          // file over the size limit.
          return Promise.resolve({ data: null, error: { message: uploadError } });
        }
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
    // Default to having artwork: a card with no image is deliberately not
    // imported (see the "skips a card with no image" test), so most tests here
    // need a real attachment to exercise the create/update/deactivate paths.
    frontImage: {
      url: "https://airtable.test/default.png",
      filename: "default.png",
      contentType: "image/png",
    },
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
    createdBuckets.length = 0;
    uploadError = null;
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
        frontImage: {
          url: "https://airtable.test/art.png",
          filename: "art.png",
          contentType: "image/png",
        },
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
    // The sync self-heals the storage bucket before copying artwork.
    expect(createdBuckets).toContain("design-assets");

    const design = await prisma.cardDesign.findUnique({ where: { externalId } });
    expect(design).not.toBeNull();
    expect(design).toMatchObject({
      name: "Sync Test Balloons",
      sku: "KC-BDAY-GEN-999",
      category: "birthday",
      isActive: true,
      thumbnailUrl: `https://storage.test/design-assets/catalog/${externalId}.png`,
    });
    // Artwork embedded as a full-bleed page background on the front page, so it
    // cover-fills the canvas at any proportion (ADR 0161) rather than as a
    // fixed-size image element that would leave a strip on the taller A6 canvas.
    const front = (
      design!.document as {
        pages: { name: string; elements: unknown[]; background?: unknown }[];
      }
    ).pages.find((p) => p.name === "front");
    expect(front!.elements).toHaveLength(0);
    expect(front!.background).toMatchObject({
      type: "image",
      assetUrl: `https://storage.test/design-assets/catalog/${externalId}.png`,
    });
    // A real inside message seeds an editable text block on the inside-right page.
    const insideRight = (
      design!.document as { pages: { name: string; elements: unknown[] }[] }
    ).pages.find((p) => p.name === "inside-right");
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
    // The slug is assigned once and must survive the rename: it's the published
    // URL, and it's printed as a QR code on cards already in the post. A slug
    // that tracked the title would silently break both. See ADR 0163.
    expect(rows[0]!.slug).toBe("first-title");
  });

  it("reports whether the public library was published, not just that rows were written", async () => {
    activeCards = [card({ externalId: `rec${randomUUID().slice(0, 14)}`, title: "Published" })];

    const response = await request(app.getHttpServer())
      .post("/catalog/sync")
      .set("Authorization", `Bearer ${await opsToken()}`)
      .expect(201);

    // "Synced" and "live on the marketing site" are different things: the app
    // reads the catalog uncached, /cards is served from an hourly ISR cache. A
    // summary that reported only the row counts let a half-published catalog
    // look finished — which is how a card ends up visible in the app and missing
    // from the public library.
    // No CATALOG_REVALIDATE_SECRET in the test environment, so the sync must say
    // it couldn't publish — and must not have failed over it.
    expect(response.body).toMatchObject({
      created: 1,
      published: { outcome: "not-configured" },
    });
    expect(JSON.stringify(response.body)).toContain("CATALOG_REVALIDATE_SECRET");
  });

  it("gives a newly synced design a slug derived from its title", async () => {
    const externalId = `rec${randomUUID().slice(0, 14)}`;
    activeCards = [card({ externalId, title: "Mum & Dad's Anniversary" })];

    await request(app.getHttpServer())
      .post("/catalog/sync")
      .set("Authorization", `Bearer ${await opsToken()}`)
      .expect(201);

    const design = await prisma.cardDesign.findUnique({ where: { externalId } });
    expect(design!.slug).toBe("mum-and-dads-anniversary");
  });

  it("suffixes the slug when two designs share a title, rather than failing the sync", async () => {
    const firstId = `rec${randomUUID().slice(0, 14)}`;
    const secondId = `rec${randomUUID().slice(0, 14)}`;
    // Same title, two distinct upstream records — a real occurrence when ops
    // add a seasonal variant of an existing card.
    activeCards = [
      card({ externalId: firstId, title: "Duplicate Title Card" }),
      card({ externalId: secondId, title: "Duplicate Title Card" }),
    ];

    const response = await request(app.getHttpServer())
      .post("/catalog/sync")
      .set("Authorization", `Bearer ${await opsToken()}`)
      .expect(201);
    expect(response.body).toMatchObject({ created: 2, errors: [] });

    const slugs = (
      await prisma.cardDesign.findMany({
        where: { externalId: { in: [firstId, secondId] } },
        orderBy: { slug: "asc" },
      })
    ).map((design) => design.slug);
    expect(slugs).toEqual(["duplicate-title-card", "duplicate-title-card-2"]);
  });

  it("deactivates a card that is no longer active upstream, leaving seeded templates alone", async () => {
    const keptId = `rec${randomUUID().slice(0, 14)}`;
    const retiredId = `rec${randomUUID().slice(0, 14)}`;
    const token = await opsToken();

    activeCards = [
      card({ externalId: keptId, title: "Kept" }),
      card({ externalId: retiredId, title: "Retired" }),
    ];
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
    expect(
      (await prisma.cardDesign.findUnique({ where: { externalId: retiredId } }))!.isActive,
    ).toBe(false);
    expect((await prisma.cardDesign.findUnique({ where: { externalId: keptId } }))!.isActive).toBe(
      true,
    );
    expect(await prisma.cardDesign.count({ where: { externalId: null, isActive: true } })).toBe(
      seededActiveBefore,
    );
  });

  it("still updates a card's name when its new artwork can't be copied", async () => {
    // The reported bug: rename a card in Airtable, sync, nothing changes.
    // The card's artwork copy was failing — the bucket only takes
    // png/jpeg/webp/gif under 10MB — and the throw skipped the whole upsert, so
    // the name, occasion, SKU and message all silently kept their old values
    // while the sync reported a clean finish.
    const token = await opsToken();
    const externalId = `rec-artwork-${randomUUID()}`;

    activeCards = [card({ externalId, title: "GSCEE Golden", category: "Congratulations" })];
    await request(app.getHttpServer())
      .post("/catalog/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    const created = await prisma.cardDesign.findUniqueOrThrow({ where: { externalId } });
    expect(created.name).toBe("GSCEE Golden");

    // Now the name is corrected upstream and the artwork replaced with
    // something the bucket rejects.
    uploadError = "mime type image/heic is not supported";
    activeCards = [card({ externalId, title: "GCSE Golden", category: "Congratulations" })];
    const response = await request(app.getHttpServer())
      .post("/catalog/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    const updated = await prisma.cardDesign.findUniqueOrThrow({ where: { externalId } });
    expect(updated.name).toBe("GCSE Golden");
    // Still showing the artwork we already held, rather than nothing.
    expect(updated.thumbnailUrl).toBe(created.thumbnailUrl);
    expect(updated.isActive).toBe(true);

    // And the artwork failure is reported — with the reason — rather than
    // passing as a clean sync.
    const summary = response.body as {
      updated: number;
      artworkFailed: { externalId: string; title: string; reason: string }[];
      errors: unknown[];
    };
    expect(summary.updated).toBe(1);
    expect(summary.errors).toHaveLength(0);
    expect(summary.artworkFailed).toHaveLength(1);
    expect(summary.artworkFailed[0]?.externalId).toBe(externalId);
    expect(summary.artworkFailed[0]?.reason).toContain("image/heic");
  });

  it("reports a brand-new card whose first artwork copy fails as a real import failure", async () => {
    // Nothing to fall back on, so this one genuinely can't go in the library.
    const token = await opsToken();
    const externalId = `rec-newfail-${randomUUID()}`;
    uploadError = "The object exceeded the maximum allowed size";
    activeCards = [card({ externalId, title: "Too Big" })];

    const response = await request(app.getHttpServer())
      .post("/catalog/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(await prisma.cardDesign.findUnique({ where: { externalId } })).toBeNull();
    const summary = response.body as {
      errors: { externalId: string; reason: string }[];
      artworkFailed: unknown[];
    };
    expect(summary.artworkFailed).toHaveLength(0);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]?.reason).toContain("maximum allowed size");
  });

  it("skips a card with no image instead of importing a placeholder", async () => {
    const externalId = `rec${randomUUID().slice(0, 14)}`;
    const token = await opsToken();
    activeCards = [card({ externalId, title: "No Art", frontImage: null })];

    const response = await request(app.getHttpServer())
      .post("/catalog/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(response.body).toMatchObject({ fetched: 1, created: 0, imagesCopied: 0 });
    expect(
      (response.body as { skippedNoImage: { externalId: string; title: string }[] }).skippedNoImage,
    ).toEqual([expect.objectContaining({ externalId, title: "No Art" })]);
    // The card never enters the catalog at all.
    expect(await prisma.cardDesign.findUnique({ where: { externalId } })).toBeNull();
  });

  it("deactivates an existing card if its Airtable image is removed", async () => {
    const externalId = `rec${randomUUID().slice(0, 14)}`;
    const token = await opsToken();

    activeCards = [card({ externalId, title: "Had Art" })];
    await request(app.getHttpServer())
      .post("/catalog/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    expect((await prisma.cardDesign.findUnique({ where: { externalId } }))!.isActive).toBe(true);

    // Same card comes back with its image removed → it drops out of the library.
    activeCards = [card({ externalId, title: "Had Art", frontImage: null })];
    const response = await request(app.getHttpServer())
      .post("/catalog/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect((response.body as { skippedNoImage: { externalId: string }[] }).skippedNoImage).toEqual([
      expect.objectContaining({ externalId }),
    ]);
    expect((await prisma.cardDesign.findUnique({ where: { externalId } }))!.isActive).toBe(false);
  });

  it("surfaces a real Airtable failure as a 502 with the reason (not a generic 500)", async () => {
    const token = await opsToken();
    const spy = jest
      .spyOn(sourceMock, "fetchActiveCards")
      .mockRejectedValueOnce(
        new Error("Airtable request failed (401) — the token is invalid or was regenerated"),
      );

    const response = await request(app.getHttpServer())
      .post("/catalog/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(502);

    expect((response.body as { message: string }).message).toContain("token is invalid");
    spy.mockRestore();
  });

  it("retries a rate-limited artwork download instead of losing the card's image", async () => {
    // The artwork download is a read of a signed attachment URL. Before, a
    // single 429 lost that card's image for the night; now it waits and asks
    // again. See ADR 0209.
    const externalId = `rec${randomUUID().slice(0, 14)}`;
    activeCards = [
      card({
        externalId,
        title: "Rate Limited Art",
        frontImage: {
          url: "https://airtable.test/rate-limited.png",
          filename: "art.png",
          contentType: "image/png",
        },
      }),
    ];
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 429,
      headers: { get: () => null },
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    });

    const token = await opsToken();
    const response = await request(app.getHttpServer())
      .post("/catalog/sync")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(response.body).toMatchObject({ imagesCopied: 1 });
    expect(uploadedPaths).toContain(`catalog/${externalId}.png`);
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
