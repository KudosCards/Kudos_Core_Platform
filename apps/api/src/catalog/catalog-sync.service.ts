import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardDesign, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { DESIGN_ASSET_STORAGE_CLIENT } from "../storage/design-asset-storage.provider";
import { DESIGN_ASSETS_BUCKET } from "../storage/storage.service";
import { CATALOG_SOURCE, type CatalogCardRecord, type CatalogSource } from "./catalog-source";
import { buildCardDocument } from "./card-document.util";

export interface CatalogSyncSummary {
  fetched: number;
  created: number;
  updated: number;
  deactivated: number;
  imagesCopied: number;
  /** Per-card failures that didn't abort the whole run (e.g. one bad image). */
  errors: { externalId: string; sku: string | null; reason: string }[];
}

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
      errors: [],
    };

    const existing = await this.prisma.cardDesign.findMany({ where: { externalId: { not: null } } });
    const byExternalId = new Map(existing.map((design) => [design.externalId as string, design]));

    for (const record of records) {
      try {
        const copied = await this.resolveArtwork(record, byExternalId.get(record.externalId));
        if (copied.copiedNow) {
          summary.imagesCopied += 1;
        }

        const data = {
          category: record.category,
          name: record.title,
          sku: record.sku,
          thumbnailUrl: copied.thumbnailUrl,
          document: buildCardDocument(copied.documentImageUrl, record.insideMessage) as Prisma.InputJsonValue,
          isActive: true,
        };

        await this.prisma.cardDesign.upsert({
          where: { externalId: record.externalId },
          create: { externalId: record.externalId, ...data },
          update: data,
        });

        if (byExternalId.has(record.externalId)) {
          summary.updated += 1;
        } else {
          summary.created += 1;
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown error";
        this.logger.error(`Failed to sync card ${record.sku ?? record.externalId}: ${reason}`);
        summary.errors.push({ externalId: record.externalId, sku: record.sku, reason });
      }
    }

    summary.deactivated = await this.deactivateRetired(records);

    this.logger.log(
      `Catalog sync: fetched ${summary.fetched}, created ${summary.created}, ` +
        `updated ${summary.updated}, deactivated ${summary.deactivated}, ` +
        `images copied ${summary.imagesCopied}, errors ${summary.errors.length}`,
    );
    return summary;
  }

  /**
   * Ensures the design-assets bucket exists and is public, using the same
   * client (project + service key) the uploads use — so operators never have to
   * hand-create it in the right project. createBucket is idempotent-ish: it
   * errors "already exists", which we treat as success (then make sure it's
   * public so thumbnails render). Any other failure is logged, not fatal — the
   * per-card copy will still report the real reason.
   */
  private async ensureBucket(): Promise<void> {
    const { error } = await this.storage.storage.createBucket(DESIGN_ASSETS_BUCKET, {
      public: true,
    });
    if (!error) {
      this.logger.log(`Created storage bucket "${DESIGN_ASSETS_BUCKET}"`);
      return;
    }
    if (/exist/i.test(error.message)) {
      // Already there — make sure it's public (a private bucket would upload
      // fine but the stored public URLs wouldn't render).
      await this.storage.storage
        .updateBucket(DESIGN_ASSETS_BUCKET, { public: true })
        .catch(() => undefined);
      return;
    }
    this.logger.warn(`Could not ensure "${DESIGN_ASSETS_BUCKET}" bucket: ${error.message}`);
  }

  /**
   * Resolves the artwork URL to persist. Copies the current Airtable attachment
   * into our storage when present; on failure (or no attachment) falls back to
   * the design's existing thumbnail so a transient image glitch doesn't blank a
   * card that already had art.
   */
  private async resolveArtwork(
    record: CatalogCardRecord,
    prior: CardDesign | undefined,
  ): Promise<{ thumbnailUrl: string; documentImageUrl: string | null; copiedNow: boolean }> {
    if (record.frontImage) {
      const url = await this.copyImage(record.externalId, record.frontImage);
      return { thumbnailUrl: url, documentImageUrl: url, copiedNow: true };
    }
    if (prior) {
      return { thumbnailUrl: prior.thumbnailUrl, documentImageUrl: prior.thumbnailUrl, copiedNow: false };
    }
    // No artwork anywhere yet — a placeholder keeps thumbnailUrl non-null and
    // signals "art missing" without embedding a broken image into the document.
    return {
      thumbnailUrl: placeholderThumbnail(record.title),
      documentImageUrl: null,
      copiedNow: false,
    };
  }

  /** Downloads the Airtable attachment and re-uploads it to our storage under a
   * stable per-card path, returning the permanent public URL. */
  private async copyImage(
    externalId: string,
    image: NonNullable<CatalogCardRecord["frontImage"]>,
  ): Promise<string> {
    const response = await fetch(image.url);
    if (!response.ok) {
      throw new Error(`Could not download artwork (${response.status})`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType =
      image.contentType ?? response.headers.get("content-type") ?? "image/png";
    const ext = extensionFor(image.filename, contentType);
    const path = `catalog/${externalId}.${ext}`;

    const { error } = await this.storage.storage
      .from(DESIGN_ASSETS_BUCKET)
      .upload(path, buffer, { contentType, upsert: true });
    if (error) {
      throw new Error(`Could not store artwork: ${error.message}`);
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

function placeholderThumbnail(title: string): string {
  const label = encodeURIComponent(title.slice(0, 30));
  return `https://placehold.co/450x600/e5e7eb/374151?text=${label}`;
}
