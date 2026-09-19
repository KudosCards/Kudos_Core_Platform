import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PrismaService } from "../prisma/prisma.service";
import type { CatalogPublisherService } from "./catalog-publisher.service";
import type { CatalogCardRecord, CatalogSource } from "./catalog-source";
import {
  DEFAULT_CARD_SIZE,
  PRINT_RUN_BLEED_MM,
  cropLossPercent,
  isCatalogArtwork,
  printedCropLoss,
} from "@kudos/shared-types";
import { CatalogSyncService } from "./catalog-sync.service";
import { CatalogCropGateService } from "./catalog-crop-gate.service";

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
function png(width: number, height: number, orientation?: number): Promise<Buffer> {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 120, b: 90 } },
  });
  return (orientation ? image.withMetadata({ orientation }) : image).png().toBuffer();
}

function record(externalId: string, title: string, sku?: string | null): CatalogCardRecord {
  return {
    externalId,
    sku: sku === undefined ? `KC-${externalId}` : sku,
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

/** Where Supabase serves a public design asset from. */
const PUBLIC_BUCKET_URL = "https://x.supabase.co/storage/v1/object/public/design-assets";

interface Harness {
  service: CatalogSyncService;
  /** The storage upload, so a test can assert refused artwork is never stored. */
  upload: jest.Mock;
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
  /** Whether the sync refuses artwork that would be cropped. Off in production
   *  until the catalog is re-exported, so off here unless a test says otherwise. */
  cropGateEnabled = false,
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

  const upload = jest.fn().mockResolvedValue({ error: null });
  const storage = {
    storage: {
      createBucket: jest.fn().mockResolvedValue({ error: null }),
      updateBucket: jest.fn().mockResolvedValue({ error: null }),
      from: () => ({
        upload,
        // Shaped like a real Supabase public URL, bucket segment and all —
        // `isCatalogArtwork` reads that path back, so a looser stub would let
        // the check pass here and fail in production.
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `${PUBLIC_BUCKET_URL}/${path}` },
        }),
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

  const cropGate = new CatalogCropGateService({
    get: jest.fn().mockResolvedValue(cropGateEnabled ? "true" : "false"),
    set: jest.fn(),
  } as unknown as ConstructorParameters<typeof CatalogCropGateService>[0]);

  return {
    service: new CatalogSyncService(prisma, source, storage, publisher, cropGate),
    upserts,
    upload,
  };
}

describe("CatalogSyncService — measuring artwork at the door", () => {
  it("stores catalog artwork where isCatalogArtwork will recognise it", async () => {
    // The editor decides whose problem a crop is by reading this path back. If
    // the sync ever wrote somewhere else, every member would start being told to
    // re-export artwork they have never seen.
    const square = await png(1000, 1000);
    const { service, upserts } = makeService([record("rec1", "Happy Tulips")], () => square);

    await service.sync();

    const url = (upserts[0]?.update as { thumbnailUrl: string }).thumbnailUrl;
    expect(isCatalogArtwork(url)).toBe(true);
  });

  it("stores the artwork's own pixel size on the design", async () => {
    const square = await png(1000, 1000);
    const { service, upserts } = makeService([record("rec1", "Happy Tulips")], () => square);

    await service.sync();

    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.update).toMatchObject({ artworkWidth: 1000, artworkHeight: 1000 });
    expect(upserts[0]?.create).toMatchObject({ artworkWidth: 1000, artworkHeight: 1000 });
  });

  it("stores a rotated photo's size the way it will be shown", async () => {
    // A portrait photo sent in sideways with a tag saying "turn me" is stored
    // 1748 x 1240 and displayed 1240 x 1748 — which is the card's shape exactly.
    // Recording the stored size made the catalog the one surface that disagreed
    // with the renderer, the artwork gate and the uploads library, and the crop
    // gate would then refuse artwork that is precisely the right shape for a
    // card. See ADR 0247.
    const sideways = await png(1748, 1240, 6);
    const { service, upserts } = makeService([record("rec1", "Turned")], () => sideways);

    await service.sync();

    expect(upserts[0]?.update).toMatchObject({ artworkWidth: 1240, artworkHeight: 1748 });
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
    // The source size travels with the finding. A percentage alone cannot be
    // turned into a re-export brief — somebody would have to go and open the
    // file to find out what it currently is.
    expect(summary.cropped[0]).toMatchObject({ width: 1500, height: 1000 });
    expect(summary.cropped[1]).toMatchObject({ width: 1000, height: 1000 });
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
      [
        {
          externalId: "rec1",
          thumbnailUrl: `${PUBLIC_BUCKET_URL}/catalog/rec1.png`,
          isActive: true,
        },
      ],
    );

    const summary = await service.sync();

    expect(summary.artworkFailed).toHaveLength(1);
    expect(upserts[0]?.update).not.toHaveProperty("artworkWidth");
    expect(upserts[0]?.update).not.toHaveProperty("artworkHeight");
  });

  it("reports the loss the press will produce, at the bleed the press is given", async () => {
    // The trap this closes: the measurement used to assume the authored canvas
    // while the renderer crops against the *page*. Those agree only because the
    // shipping path passes no bleed. `renderPdf` still defaults to 3mm for a
    // future print house, and on such a page a 2:3 source loses 11.1% of its
    // height rather than 6% — so the sync would have gone on reporting half of
    // what was actually being thrown away.
    const twoThree = await png(1000, 1500);
    const { service } = makeService([record("rec1", "Happy Tulips")], () => twoThree);

    const summary = await service.sync();

    const expected = printedCropLoss(
      { width: 1000, height: 1500 },
      { size: DEFAULT_CARD_SIZE, bleedMm: PRINT_RUN_BLEED_MM },
    );
    expect(summary.cropped[0]?.percent).toBe(cropLossPercent(expected));
    // And that is the 6% the catalog actually shows, on 207 of 217 designs.
    expect(summary.cropped[0]?.percent).toBe(6);
  });
});

/**
 * The gate closed — what happens on the day the catalog has been re-exported
 * and ops switch it on. See docs/card-artwork-shape-plan.md, Phase 5.
 */
describe("CatalogSyncService — refusing cropped artwork", () => {
  it("lets the catalog in untouched while the gate is open", async () => {
    // Today. 207 of 217 designs are 2:3, so a gate that refused by default
    // would empty the library on the next sync.
    const twoThree = await png(1000, 1500);
    const { service, upload } = makeService([record("rec1", "Happy Tulips")], () => twoThree);

    const summary = await service.sync();

    expect(summary.imagesCopied).toBe(1);
    expect(summary.artworkFailed).toHaveLength(0);
    expect(upload).toHaveBeenCalled();
  });

  it("refuses the 6% crop once it is closed, and says what to export", async () => {
    const twoThree = await png(1000, 1500);
    const { service } = makeService(
      [record("rec1", "Happy Tulips")],
      () => twoThree,
      [
        {
          externalId: "rec1",
          thumbnailUrl: `${PUBLIC_BUCKET_URL}/catalog/rec1.png`,
          isActive: true,
        },
      ],
      true,
    );

    const summary = await service.sync();

    expect(summary.artworkFailed).toHaveLength(1);
    expect(summary.artworkFailed[0]?.reason).toContain("6% of its height");
    expect(summary.artworkFailed[0]?.reason).toContain("1748 × 2480");
  });

  it("does not store artwork it has refused", async () => {
    // The refusal happens before the upload. Writing a file we have just
    // declined would leave the bucket holding artwork nothing references.
    const twoThree = await png(1000, 1500);
    const { service, upload } = makeService(
      [record("rec1", "Happy Tulips")],
      () => twoThree,
      [
        {
          externalId: "rec1",
          thumbnailUrl: `${PUBLIC_BUCKET_URL}/catalog/rec1.png`,
          isActive: true,
        },
      ],
      true,
    );

    await service.sync();

    expect(upload).not.toHaveBeenCalled();
  });

  it("keeps a card's existing artwork and still updates its text", async () => {
    // A refusal is not a reason to take a card off the shelf. The name, SKU and
    // inside message are current; only the new picture was declined.
    const twoThree = await png(1000, 1500);
    const { service, upserts } = makeService(
      [record("rec1", "Renamed Tulips")],
      () => twoThree,
      [
        {
          externalId: "rec1",
          thumbnailUrl: `${PUBLIC_BUCKET_URL}/catalog/rec1.png`,
          isActive: true,
        },
      ],
      true,
    );

    const summary = await service.sync();

    expect(summary.errors).toHaveLength(0);
    expect(upserts[0]?.update).toMatchObject({
      name: "Renamed Tulips",
      thumbnailUrl: `${PUBLIC_BUCKET_URL}/catalog/rec1.png`,
      isActive: true,
    });
    // And the size measured for the artwork still on the card is not blanked.
    expect(upserts[0]?.update).not.toHaveProperty("artworkWidth");
  });

  it("keeps a brand-new card out rather than importing it with no artwork", async () => {
    // Nothing to fall back on, so this is a genuine import failure — the same
    // shape as a card whose artwork could not be copied at all.
    const twoThree = await png(1000, 1500);
    const { service, upserts } = makeService(
      [record("rec1", "Happy Tulips")],
      () => twoThree,
      [],
      true,
    );

    const summary = await service.sync();

    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]?.reason).toContain("would be cropped off");
    expect(upserts).toHaveLength(0);
  });

  it("admits artwork at the size it asks for", async () => {
    // Or the gate would be a trap: closing it could never be satisfied.
    const ideal = await png(1240, 1748);
    const { service } = makeService([record("rec1", "Made For Us")], () => ideal, [], true);

    const summary = await service.sync();

    expect(summary.imagesCopied).toBe(1);
    expect(summary.errors).toHaveLength(0);
    expect(summary.cropped).toHaveLength(0);
  });
});

/**
 * What the catalog data itself can be wrong about. None of it corrupts
 * anything — all three are fixed in Airtable — which is exactly why none of it
 * was visible until the sync started saying so.
 */
describe("CatalogSyncService — reporting the data, not just the artwork", () => {
  it("names the cards sharing one product code", async () => {
    // Every list here reads "Title (SKU)", and the crop worklist is handed to
    // somebody as codes to re-export. Two cards on one code cannot be worked
    // from: finishing one looks identical to finishing both.
    const art = await png(1240, 1748);
    const { service } = makeService(
      [
        record("rec1", "Lewis Carroll", "KC-INSPIRATIONAL-GEN-011"),
        record("rec2", "Henry Fielding Habits", "KC-INSPIRATIONAL-GEN-011"),
        record("rec3", "Jane Austen", "KC-INSPIRATIONAL-GEN-009"),
      ],
      () => art,
    );

    const summary = await service.sync();

    expect(summary.duplicateSkus).toHaveLength(1);
    expect(summary.duplicateSkus[0]?.sku).toBe("KC-INSPIRATIONAL-GEN-011");
    expect(summary.duplicateSkus[0]?.designs.map((d) => d.title)).toEqual([
      "Lewis Carroll",
      "Henry Fielding Habits",
    ]);
  });

  it("names the cards that will collide on their URL, permanently", async () => {
    const art = await png(1240, 1748);
    const { service } = makeService(
      [record("rec1", "Well Done - Flowers"), record("rec2", "Well Done - Flowers")],
      () => art,
    );

    const summary = await service.sync();

    expect(summary.duplicateNames).toHaveLength(1);
    expect(summary.duplicateNames[0]?.slug).toBe("well-done-flowers");
  });

  it("counts the categories with no landing page to sit on", async () => {
    const art = await png(1240, 1748);
    const { service } = makeService(
      [
        { ...record("rec1", "Snowy Penguin"), category: "christmas" },
        { ...record("rec2", "Snow Globe"), category: "christmas" },
        { ...record("rec3", "Happy Tulips"), category: "birthday" },
      ],
      () => art,
    );

    const summary = await service.sync();

    // Birthday publishes; christmas does not, so those two cards are living at
    // /cards/other/… with nothing for a customer to search for.
    expect(summary.unpublishedCategories).toEqual([{ category: "christmas", count: 2 }]);
  });

  it("says nothing about a catalog that is in good order", async () => {
    // The discriminator: three sections that appear on every sync are three
    // sections nobody reads.
    const art = await png(1240, 1748);
    const { service } = makeService(
      [record("rec1", "Happy Tulips"), record("rec2", "Snowy Penguin")],
      () => art,
    );

    const summary = await service.sync();

    expect(summary.duplicateSkus).toEqual([]);
    expect(summary.duplicateNames).toEqual([]);
    expect(summary.unpublishedCategories).toEqual([]);
  });
});
