import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Prisma } from "@prisma/client";
import { deriveCardSlugBase, uniqueCardSlug } from "@kudos/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { DESIGN_ASSET_STORAGE_CLIENT } from "../storage/design-asset-storage.provider";
import {
  BUCKET_CONFIGS,
  DESIGN_ASSETS_BUCKET,
  ensureBucketConfigured,
} from "../storage/storage.service";
import {
  CATALOG_SOURCE,
  type CatalogCardRecord,
  type CatalogFieldMapping,
  type CatalogSource,
} from "./catalog-source";
import { buildCardDocument } from "./card-document.util";

export interface CatalogSyncSummary {
  fetched: number;
  created: number;
  updated: number;
  deactivated: number;
  imagesCopied: number;
  /** Records skipped because they have no artwork attached in Airtable — these
   * are deliberately not imported into the library (see resolveArtwork removal). */
  skippedNoImage: { externalId: string; sku: string | null; title: string }[];
  /**
   * Cards whose text updated but whose **new artwork couldn't be copied**, so
   * they're still showing the previously stored image. Distinct from `errors`:
   * the card is in the library and current apart from its picture.
   */
  artworkFailed: { externalId: string; sku: string | null; title: string; reason: string }[];
  /** Per-card failures that kept the card out of the library entirely. */
  errors: { externalId: string; sku: string | null; reason: string }[];
  /**
   * Which upstream columns the sync actually read. Present when the source can
   * report it (Airtable can; a fixed-schema source has nothing to explain).
   *
   * Here because "I edited the name in Airtable and nothing changed" has no
   * error to look at: field matching is tolerant, so a table with two
   * title-ish columns reads one and ignores the other, and the sync reports a
   * clean success either way. This makes the choice visible.
   */
  fieldMapping?: CatalogFieldMapping;
}

// How many artwork copies run at once. High enough that a few hundred cards
// finish in seconds (so the request doesn't time out), low enough not to hammer
// Supabase storage or exhaust the DB connection pool.
const IMAGE_COPY_CONCURRENCY = 8;

/** Retries when a slug is claimed by a concurrent writer between pick and insert. */
const SLUG_ASSIGNMENT_ATTEMPTS = 5;

/** Prisma's unique-constraint error, narrowed to the slug index. */
function isSlugUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, meta } = error as { code?: unknown; meta?: { target?: unknown } };
  if (code !== "P2002") return false;
  // Prisma reports `meta.target` as string[] on Postgres, but it's typed loosely
  // and can be absent — narrow rather than stringify an unknown.
  const target = meta?.target;
  const fields = Array.isArray(target)
    ? target.filter((field): field is string => typeof field === "string")
    : typeof target === "string"
      ? [target]
      : [];
  return fields.some((field) => field.includes("slug"));
}

// Cap on a single artwork download so one hung Airtable attachment can't stall
// the whole run.
const IMAGE_DOWNLOAD_TIMEOUT_MS = 20_000;

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Pulls the card catalog from the CatalogSource (Airtable in production) into
 * the CardDesign table. Idempotent: each card upserts by its Airtable record id
 * (external_id), and cards that are no longer active upstream are deactivated
 * rather than deleted (so any SavedDesign already derived from one keeps its FK).
 * Seeded templates (external_id = null) are never touched.
 *
 * Because Airtable attachment URLs expire, each artwork is copied into our own
 * Supabase storage and it's that permanent URL we persist — never Airtable's.
 * See docs/adr/0011-airtable-catalog-sync.md.
 */
@Injectable()
export class CatalogSyncService {
  private readonly logger = new Logger(CatalogSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CATALOG_SOURCE) private readonly source: CatalogSource,
    @Inject(DESIGN_ASSET_STORAGE_CLIENT) private readonly storage: SupabaseClient,
  ) {}

  isConfigured(): boolean {
    return this.source.isConfigured();
  }

  async sync(): Promise<CatalogSyncSummary> {
    if (!this.source.isConfigured()) {
      throw new ServiceUnavailableException(
        "Airtable is not configured — set AIRTABLE_API_KEY and AIRTABLE_BASE_ID",
      );
    }

    // Surface the real Airtable failure (bad token, wrong base/table, rate
    // limit) to the operator instead of a generic 500 — an ops tool has to say
    // *why* a sync failed, or it can't be operated. See docs/adr/0011.
    let records: CatalogCardRecord[];
    try {
      records = await this.source.fetchActiveCards();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Airtable fetch failed: ${message}`);
      throw new BadGatewayException(`Could not read the catalog from Airtable: ${message}`);
    }

    // Self-heal the storage bucket: create it (public) in the very project the
    // uploads target, so a missing/mis-named/wrong-project bucket can't turn
    // every artwork copy into "Bucket not found". Idempotent — a no-op when it
    // already exists.
    await this.ensureBucket();

    const summary: CatalogSyncSummary = {
      fetched: records.length,
      created: 0,
      updated: 0,
      deactivated: 0,
      imagesCopied: 0,
      skippedNoImage: [],
      artworkFailed: [],
      errors: [],
    };

    const existing = await this.prisma.cardDesign.findMany({
      where: { externalId: { not: null } },
    });
    const byExternalId = new Map(existing.map((design) => [design.externalId as string, design]));

    // Every slug already in use, including seeded templates that have no
    // externalId. Workers claim from this set synchronously (JS is
    // single-threaded, so claim-then-await is atomic within this process); the
    // unique index catches anything a *concurrent* sync elsewhere took first.
    const takenSlugs = new Set(
      (await this.prisma.cardDesign.findMany({ select: { slug: true } })).map(
        (design) => design.slug,
      ),
    );

    // Copy artwork with bounded concurrency, not one-at-a-time: a few hundred
    // sequential image download+upload round-trips take long enough that the
    // HTTP request times out before responding. Tallies are applied after each
    // card resolves (single-threaded, so no locking needed).
    await mapWithConcurrency(records, IMAGE_COPY_CONCURRENCY, async (record) => {
      try {
        const prior = byExternalId.get(record.externalId);

        // Only cards with real artwork belong in the library. A record with no
        // image attached in Airtable is never imported: a brand-new one is
        // skipped entirely, and one that previously had art is deactivated so it
        // drops out of the library (its row is kept for FK integrity). This
        // replaces the old "placeholder thumbnail" fallback that let an art-less
        // card show a grey box. See docs/adr/0011.
        if (!record.frontImage) {
          if (prior?.isActive) {
            await this.prisma.cardDesign.update({
              where: { externalId: record.externalId },
              data: { isActive: false },
            });
          }
          summary.skippedNoImage.push({
            externalId: record.externalId,
            sku: record.sku,
            title: record.title,
          });
          return;
        }

        // Artwork and metadata are copied **independently**, and this is the
        // whole point of the block.
        //
        // The design-assets bucket only accepts png/jpeg/webp/gif under 10MB, so
        // a HEIC straight off a phone, an SVG, a PDF or an oversized export
        // makes the copy fail. That is a perfectly ordinary thing to happen to
        // one card in a catalog. What used to happen next was not: the throw
        // skipped the upsert entirely, so the card's **name, occasion, SKU and
        // inside message all silently kept their old values** while the sync
        // reported a clean finish. Renaming a card in Airtable and re-syncing
        // did nothing, for a reason nothing on screen connected to the name.
        let imageUrl: string | null = null;
        let artworkFailure: string | null = null;
        try {
          imageUrl = await this.copyImage(record.externalId, record.frontImage);
        } catch (error) {
          artworkFailure = error instanceof Error ? error.message : "Unknown error";
        }

        // Fall back to the artwork already stored for this card, so the rest of
        // the record still updates. Only a card with nothing to show at all —
        // new, and its first copy failed — is a genuine import failure.
        const thumbnailUrl = imageUrl ?? prior?.thumbnailUrl ?? null;
        if (!thumbnailUrl) {
          summary.errors.push({
            externalId: record.externalId,
            sku: record.sku,
            reason: artworkFailure ?? "No artwork could be stored",
          });
          return;
        }

        const data = {
          category: record.category,
          name: record.title,
          sku: record.sku,
          thumbnailUrl,
          document: buildCardDocument(thumbnailUrl, record.insideMessage) as Prisma.InputJsonValue,
          isActive: true,
        };

        // The slug is assigned once, on create, and deliberately absent from
        // `update`: renaming a card in Airtable must not change a published URL
        // or break the QR codes on cards already in the post (ADR 0163).
        await this.upsertWithSlug(record, data, takenSlugs);

        if (imageUrl) {
          summary.imagesCopied += 1;
        } else {
          // Updated, but still showing the old picture — a different problem
          // from "didn't import", and it needs saying out loud.
          summary.artworkFailed.push({
            externalId: record.externalId,
            sku: record.sku,
            title: record.title,
            reason: artworkFailure ?? "Unknown error",
          });
        }
        if (prior) {
          summary.updated += 1;
        } else {
          summary.created += 1;
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Failed to sync card ${record.sku ?? record.externalId}: ${reason}`);
        summary.errors.push({ externalId: record.externalId, sku: record.sku, reason });
      }
    });

    summary.deactivated = await this.deactivateRetired(records);
    summary.fieldMapping = this.source.lastFieldMapping?.() ?? undefined;

    // A field with more than one populated alias is the shape of "my edit did
    // nothing": the sync read one column and silently ignored the other.
    for (const [field, resolution] of Object.entries(summary.fieldMapping?.fields ?? {})) {
      if (resolution.alsoPresent.length > 0) {
        this.logger.warn(
          `Catalog sync: "${field}" read from "${resolution.using}" — ` +
            `also populated upstream: ${resolution.alsoPresent.join(", ")}. ` +
            `An edit in one of those is being ignored.`,
        );
      }
    }

    this.logger.log(
      `Catalog sync: fetched ${summary.fetched}, created ${summary.created}, ` +
        `updated ${summary.updated}, deactivated ${summary.deactivated}, ` +
        `skipped-no-image ${summary.skippedNoImage.length}, ` +
        `images copied ${summary.imagesCopied}, artwork-failed ${summary.artworkFailed.length}, ` +
        `errors ${summary.errors.length}`,
    );
    return summary;
  }

  /**
   * Ensures the design-assets bucket exists — public, with the shared
   * mime/size limits (`BUCKET_CONFIGS`) — using the same client (project +
   * service key) the uploads use, so operators never have to hand-create it in
   * the right project. Idempotent and non-fatal: a failure is logged and the
   * per-card copy still reports the real reason. Shares one implementation
   * with the boot-time ensure in StorageService so the bucket's config can't
   * drift between the two paths.
   */
  /**
   * Upsert a synced design, assigning a slug only when the row is created.
   *
   * Two syncs can run at once (a scheduled run and an ops-triggered "Refresh
   * catalog"), and this sync itself creates cards on 8 concurrent workers, so a
   * slug claimed in memory can still lose a race to the database. A unique
   * violation on `slug` is therefore expected rather than exceptional: mark the
   * loser as taken and try the next suffix. Bounded, so a genuine unique
   * violation on some *other* column can't spin forever.
   */
  private async upsertWithSlug(
    record: CatalogCardRecord,
    // Everything except the identity columns this method owns: `slug` is
    // assigned here on create, and `externalId` is the upsert key.
    data: Omit<Prisma.CardDesignUncheckedCreateInput, "id" | "slug" | "externalId">,
    takenSlugs: Set<string>,
  ): Promise<void> {
    const base = deriveCardSlugBase({
      name: record.title,
      sku: record.sku,
      externalId: record.externalId,
      // Only reached when name, sku and externalId all slugify to nothing.
      // externalId is always present here, so this is a belt-and-braces value.
      id: record.externalId,
    });

    for (let attempt = 0; attempt < SLUG_ASSIGNMENT_ATTEMPTS; attempt += 1) {
      const slug = uniqueCardSlug(base, takenSlugs);
      takenSlugs.add(slug);
      try {
        await this.prisma.cardDesign.upsert({
          where: { externalId: record.externalId },
          create: { ...data, externalId: record.externalId, slug },
          update: data,
        });
        return;
      } catch (error) {
        if (!isSlugUniqueViolation(error)) throw error;
        this.logger.warn(`Slug "${slug}" was taken concurrently; retrying ${record.externalId}`);
      }
    }

    throw new Error(
      `Could not assign a unique slug for ${record.sku ?? record.externalId} after ` +
        `${SLUG_ASSIGNMENT_ATTEMPTS} attempts`,
    );
  }

  private async ensureBucket(): Promise<void> {
    const config = BUCKET_CONFIGS.find((c) => c.name === DESIGN_ASSETS_BUCKET);
    if (config) {
      await ensureBucketConfigured(this.storage, config, this.logger);
    }
  }

  /** Downloads the Airtable attachment and re-uploads it to our storage under a
   * stable per-card path, returning the permanent public URL. */
  private async copyImage(
    externalId: string,
    image: NonNullable<CatalogCardRecord["frontImage"]>,
  ): Promise<string> {
    const response = await fetch(image.url, {
      signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Could not download artwork from Airtable (HTTP ${response.status})`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = image.contentType ?? response.headers.get("content-type") ?? "image/png";
    const ext = extensionFor(image.filename, contentType);
    const path = `catalog/${externalId}.${ext}`;

    const { error } = await this.storage.storage
      .from(DESIGN_ASSETS_BUCKET)
      .upload(path, buffer, { contentType, upsert: true });
    if (error) {
      // Name the type and size. The bucket only accepts png/jpeg/webp/gif under
      // 10MB, and the two ways this realistically fails are a phone/Mac export
      // (HEIC) and an oversized print-resolution file — neither of which is
      // guessable from "Could not store artwork" alone.
      const megabytes = (buffer.length / 1_048_576).toFixed(1);
      throw new Error(`Could not store artwork (${contentType}, ${megabytes}MB): ${error.message}`);
    }

    const {
      data: { publicUrl },
    } = this.storage.storage.from(DESIGN_ASSETS_BUCKET).getPublicUrl(path);
    return publicUrl;
  }

  /** Deactivates external-sourced designs no longer present upstream. Skipped
   * when the fetch returned nothing, so a transient empty response can't blank
   * the entire catalog. */
  private async deactivateRetired(records: CatalogCardRecord[]): Promise<number> {
    if (records.length === 0) {
      this.logger.warn("Catalog sync fetched 0 cards — skipping deactivation as a safety measure");
      return 0;
    }
    const activeIds = records.map((record) => record.externalId);
    const { count } = await this.prisma.cardDesign.updateMany({
      where: { externalId: { notIn: activeIds, not: null }, isActive: true },
      data: { isActive: false },
    });
    return count;
  }
}

function extensionFor(filename: string | null, contentType: string): string {
  const fromName = filename?.split(".").pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) {
    return fromName;
  }
  return CONTENT_TYPE_EXTENSIONS[contentType.toLowerCase()] ?? "png";
}

/**
 * Runs `fn` over `items` with at most `limit` in flight at once. A fixed pool of
 * workers pulls from a shared cursor — simple, no dependency, and keeps memory
 * flat regardless of how large the catalog grows.
 */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}
