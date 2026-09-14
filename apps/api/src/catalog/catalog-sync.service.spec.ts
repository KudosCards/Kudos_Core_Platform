import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PrismaService } from "../prisma/prisma.service";
import type { CatalogPublisherService } from "./catalog-publisher.service";
import type { CatalogCardRecord, CatalogSource } from "./catalog-source";
import { CatalogSyncService } from "./catalog-sync.service";

/**
 * The catalog sync is the door.
 *
 * A page background is drawn full-bleed and centre-cropped to the card's
 * 1:1.409, so artwork of any other shape loses its edges — 29% of the width for
 * a square source, the default output of most illustration tools. Nothing
 * measured that anywhere: no `sharp` call, no stored width or height. Artwork
 * went from Airtable to a printed card without anything ever asking what shape
 * it was.
 *
 * This is the one place where the artwork is ours and a person can fix it before
 * a customer ever sees it, and the bytes are already in a Buffer here — so the
 * measurement costs one local header read and no extra download.
 * See docs/card-artwork-crop-plan.md.
 */

/** Real PNG bytes at a given shape, so the measurement under test is the real
 *  `sharp` reading a real header rather than a stub agreeing with itself. */
function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 90 } },
  })
    .png()
    .toBuffer();
}

function record(externalId: string, title: string): CatalogCardRecord {
  return {
    externalId,
    sku: `KC-${externalId}`,
    title,
    category: "birthday",
    frontImage: {
      url: `https://airtable.test/${externalId}.png`,
      filename: null,
      contentType: "image/png",
    },
    insideMessage: null,
  };
}

/** Just enough of `prisma.cardDesign.upsert`'s argument to record what the sync
 *  asked for. */
interface UpsertArgs {
  where: { externalId: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

interface Harness {
  service: CatalogSyncService;
  upserts: {
    externalId: string;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }[];
}

function makeService(
  records: CatalogCardRecord[],
  bytesFor: (url: string) => Buffer | "download-fails" | "not-an-image",
  /** Designs already in the library, as `findMany` would return them. */
  existing: { externalId: string; thumbnailUrl: string; isActive: boolean }[] = [],
): Harness {
  const upserts: Harness["upserts"] = [];

  const prisma = {
    cardDesign: {
      findMany: jest.fn().mockResolvedValue(existing),
      upsert: jest.fn((args: UpsertArgs) => {
        upserts.push({
          externalId: args.where.externalId,
          create: args.create,
          update: args.update,
        });
        return Promise.resolve({});
      }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  } as unknown as PrismaService;

  const source: CatalogSource = {
    isConfigured: () => true,
    fetchActiveCards: () => Promise.resolve(records),
  };

  const storage = {
    storage: {
      createBucket: jest.fn().mockResolvedValue({ error: null }),
      updateBucket: jest.fn().mockResolvedValue({ error: null }),
      from: () => ({
        upload: jest.fn().mockResolvedValue({ error: null }),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
      }),
    },
  } as unknown as SupabaseClient;

  const publisher = {
    publish: jest.fn().mockResolvedValue({ outcome: "not-configured" }),
  } as unknown as CatalogPublisherService;

  // The artwork download. Real Response objects, so the service's own
  // `arrayBuffer()`/status handling is exercised rather than mocked away.
  global.fetch = jest.fn((url: string | URL) => {
    const bytes = bytesFor(String(url));
    if (bytes === "download-fails") {
      return Promise.resolve(new Response(null, { status: 500 }));
    }
    const body = bytes === "not-an-image" ? Buffer.from("this is not a png") : bytes;
    return Promise.resolve(new Response(new Uint8Array(body), { status: 200 }));
  }) as unknown as typeof fetch;

  return { service: new CatalogSyncService(prisma, source, storage, publisher), upserts };
}

describe("CatalogSyncService — measuring artwork at the door", () => {
  it("stores the artwork's own pixel size on the design", async () => {
    const square = await png(1000, 1000);
    const { service, upserts } = makeService([record("rec1", "Happy Tulips")], () => square);

    await service.sync();

    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.update).toMatchObject({ artworkWidth: 1000, artworkHeight: 1000 });
    expect(upserts[0]?.create).toMatchObject({ artworkWidth: 1000, artworkHeight: 1000 });
  });

  it("reports how much of each cropped design is not printed, worst first", async () => {
    const shapes: Record<string, Buffer> = {
      "https://airtable.test/wide.png": await png(1500, 1000), // landscape — 53%
      "https://airtable.test/square.png": await png(1000, 1000), // 29%
      "https://airtable.test/three-four.png": await png(1000, 1333), // 5%
      "https://airtable.test/fits.png": await png(900, 1268), // the card's own shape
    };
    const { service } = makeService(
      [
        record("three-four", "Gentle Stripes"),
        record("fits", "Made For Us"),
        record("wide", "Panorama"),
        record("square", "Happy Tulips"),
      ],
      (url) => shapes[url]!,
    );

    const summary = await service.sync();

    expect(summary.cropped.map((c) => [c.title, c.percent, c.verdict])).toEqual([
      ["Panorama", 53, "heavy"],
      ["Happy Tulips", 29, "heavy"],
      ["Gentle Stripes", 5, "noticeable"],
    ]);
    // "Made For Us" fits, so it is not in the list at all. A report that named
    // every design would be a report nobody reads.
    expect(summary.cropped.map((c) => c.title)).not.toContain("Made For Us");
    expect(summary.cropped[0]?.axis).toBe("width");
  });

  it("leaves a design unmeasured rather than failing the sync it cannot read", async () => {
    // The upload has already succeeded by this point. A file sharp cannot parse
    // — a format it does not know, a truncated download — must leave the card
    // unmeasured, not take down a sync that otherwise worked. Unmeasured and
    // wrongly-measured are different, and only one of them is safe.
    const { service, upserts } = makeService(
      [record("rec1", "Happy Tulips")],
      () => "not-an-image",
    );

    const summary = await service.sync();

    expect(summary.errors).toHaveLength(0);
    expect(summary.imagesCopied).toBe(1);
    expect(upserts[0]?.update).toMatchObject({ artworkWidth: null, artworkHeight: null });
    expect(summary.cropped).toHaveLength(0);
  });

  it("does not blank a stored size when this run could not copy the artwork", async () => {
    // The card falls back to its previously stored image, so the size measured
    // for *that* image is still the truth. Writing null here would throw away a
    // measurement to describe a copy that never happened.
    const { service, upserts } = makeService(
      [record("rec1", "Happy Tulips")],
      () => "download-fails",
      // Already has artwork stored, so the sync falls back to it rather than
      // treating this as a failed import.
      [{ externalId: "rec1", thumbnailUrl: "https://cdn.test/catalog/rec1.png", isActive: true }],
    );

    const summary = await service.sync();

    expect(summary.artworkFailed).toHaveLength(1);
    expect(upserts[0]?.update).not.toHaveProperty("artworkWidth");
    expect(upserts[0]?.update).not.toHaveProperty("artworkHeight");
  });
});
