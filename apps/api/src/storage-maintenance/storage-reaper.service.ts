import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EnvConfig } from "../config/env.schema";
import { PrismaService } from "../prisma/prisma.service";
import { DESIGN_ASSET_STORAGE_CLIENT } from "../storage/design-asset-storage.provider";
import { DESIGN_ASSETS_BUCKET } from "../storage/storage.service";

/**
 * Catalog artwork lives under this prefix (see catalog-sync.service.ts). The
 * reaper never touches it: catalog images are managed by the catalog sync
 * (deactivation deliberately leaves the object so historical designs that
 * embedded it keep rendering), so they are out of scope for orphan reaping.
 */
const CATALOG_PREFIX = "catalog/";

/** Supabase Storage's `list` default/again page size — we page through it. */
const LIST_PAGE_SIZE = 100;
/** Deletes are batched into `remove([...])` calls of at most this many paths. */
const DELETE_BATCH_SIZE = 100;
/**
 * Hard ceiling on deletions per run. A conservative backstop: if reference
 * extraction were ever wrong, this caps the blast radius to something an
 * operator would notice and investigate rather than losing everything at once.
 */
const MAX_DELETIONS_PER_RUN = 1000;

/** Pulls every `design-assets/<path>` occurrence out of arbitrary text. */
const ASSET_PATH_RE = /\/design-assets\/([^"'\s\\)?]+)/g;

export interface ReapSummary {
  /** Whether this run actually deleted (false = report-only dry run). */
  dryRun: boolean;
  /** Objects walked in the bucket (excluding catalog artwork). */
  scanned: number;
  /** Distinct storage paths referenced by a DB record. */
  referenced: number;
  /** Unreferenced objects skipped because they're inside the grace window. */
  recentlyUploaded: number;
  /** Unreferenced, past-grace objects eligible for deletion. */
  orphaned: number;
  /** Objects actually removed from storage (0 on a dry run). */
  deleted: number;
  /** True if the per-run cap was hit and some orphans were left for next time. */
  capped: boolean;
}

/** A storage object plus the info the reaper needs to decide its fate. */
interface StorageObject {
  /** Full path within the bucket, e.g. "<accountId>/<uuid>-name.png". */
  path: string;
  /** When the object was uploaded, or null if storage didn't report it. */
  createdAt: Date | null;
}

/**
 * Reclaims orphaned Supabase Storage objects: files in the design-assets bucket
 * that no longer back any DB record. They accumulate deliberately — deleting a
 * library asset leaves its object in place (a design may still embed the same
 * url — see ADR 0070), and an upload the user abandoned before saving is never
 * recorded at all. Over time that's dead storage nobody can reach.
 *
 * The reaper is conservative by construction and ships dark: it only deletes
 * when STORAGE_REAPER_ENABLED is set, only objects referenced by NOTHING
 * (DesignAsset urls, CardDesign artwork, or any url embedded in a SavedDesign /
 * CardDesign document), only past a grace window, never catalog artwork, and
 * never more than a capped number per run. See
 * docs/adr/0074-orphaned-asset-reaper.md.
 */
@Injectable()
export class StorageReaperService {
  private readonly logger = new Logger(StorageReaperService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(DESIGN_ASSET_STORAGE_CLIENT) private readonly storage: SupabaseClient,
  ) {}

  /** Whether the reaper is allowed to actually delete (env opt-in). */
  isEnabled(): boolean {
    const raw = this.config.get("STORAGE_REAPER_ENABLED", { infer: true });
    return raw === "true" || raw === "1";
  }

  private graceMs(): number {
    const days = Number(this.config.get("STORAGE_REAPER_GRACE_DAYS", { infer: true })) || 7;
    return days * 24 * 60 * 60 * 1000;
  }

  /**
   * Walk the bucket, cross-reference against every DB-held url, and delete
   * unreferenced past-grace objects. `dryRun` (or the feature being disabled)
   * reports what *would* go without removing anything, so an operator can
   * eyeball a run before trusting it.
   */
  async reap({ dryRun = false }: { dryRun?: boolean } = {}): Promise<ReapSummary> {
    const referenced = await this.collectReferencedPaths();
    const objects = await this.listAllObjects();

    const cutoff = Date.now() - this.graceMs();
    const orphans: string[] = [];
    let recentlyUploaded = 0;

    for (const object of objects) {
      if (referenced.has(object.path)) continue;
      // No createdAt (older storage backends omit it) ⇒ treat as recent and
      // leave it: we never delete an object we can't prove is past the grace.
      if (!object.createdAt || object.createdAt.getTime() >= cutoff) {
        recentlyUploaded += 1;
        continue;
      }
      orphans.push(object.path);
    }

    const capped = orphans.length > MAX_DELETIONS_PER_RUN;
    const toDelete = capped ? orphans.slice(0, MAX_DELETIONS_PER_RUN) : orphans;

    let deleted = 0;
    if (!dryRun && this.isEnabled() && toDelete.length > 0) {
      deleted = await this.removeObjects(toDelete);
    }

    return {
      dryRun: dryRun || !this.isEnabled(),
      scanned: objects.length,
      referenced: referenced.size,
      recentlyUploaded,
      orphaned: orphans.length,
      deleted,
      capped,
    };
  }

  /**
   * Every storage path referenced by a DB record, so anything reachable is
   * safe. Covers three sources: DesignAsset library urls, CardDesign artwork
   * (thumbnail + any url embedded in its document), and any url embedded in a
   * SavedDesign document. Documents are opaque JSON, so we stringify and pull
   * out every `design-assets/<path>` occurrence rather than guessing the shape.
   */
  private async collectReferencedPaths(): Promise<Set<string>> {
    const paths = new Set<string>();

    const [assets, cardDesigns, savedDesigns] = await Promise.all([
      this.prisma.designAsset.findMany({ select: { url: true } }),
      this.prisma.cardDesign.findMany({ select: { thumbnailUrl: true, document: true } }),
      this.prisma.savedDesign.findMany({ select: { document: true } }),
    ]);

    for (const asset of assets) {
      addExtractedPaths(paths, asset.url);
    }
    for (const design of cardDesigns) {
      addExtractedPaths(paths, design.thumbnailUrl);
      addExtractedPaths(paths, JSON.stringify(design.document));
    }
    for (const design of savedDesigns) {
      addExtractedPaths(paths, JSON.stringify(design.document));
    }

    return paths;
  }

  /**
   * Every object in the design-assets bucket, excluding catalog artwork.
   * Objects are laid out one folder per account (`<accountId>/<file>`; see
   * StorageService.createSignedUpload), so we list the root to find the account
   * folders and page through each. Supabase surfaces a folder as a zero-`id`
   * entry, which is how we tell a directory from a file.
   */
  private async listAllObjects(): Promise<StorageObject[]> {
    const objects: StorageObject[] = [];
    for (const folder of await this.listFolder("")) {
      if (folder.isDir) {
        if (`${folder.name}/` === CATALOG_PREFIX) continue; // never reap catalog artwork
        for (const entry of await this.listFolder(folder.name)) {
          if (entry.isDir) continue; // uploads are flat within an account folder
          objects.push({ path: `${folder.name}/${entry.name}`, createdAt: entry.createdAt });
        }
      } else {
        // A file at the bucket root (unexpected for our layout) — reapable too.
        objects.push({ path: folder.name, createdAt: folder.createdAt });
      }
    }
    return objects;
  }

  /** One folder level, paged to completion. */
  private async listFolder(
    prefix: string,
  ): Promise<{ name: string; isDir: boolean; createdAt: Date | null }[]> {
    const entries: { name: string; isDir: boolean; createdAt: Date | null }[] = [];
    for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
      const { data, error } = await this.storage.storage
        .from(DESIGN_ASSETS_BUCKET)
        .list(prefix, { limit: LIST_PAGE_SIZE, offset });
      if (error) {
        throw new Error(`Could not list storage folder "${prefix}": ${error.message}`);
      }
      if (!data || data.length === 0) break;
      for (const item of data) {
        entries.push({
          name: item.name,
          // Supabase marks a pseudo-folder with a null id and no metadata.
          isDir: item.id === null,
          createdAt: item.created_at ? new Date(item.created_at) : null,
        });
      }
      if (data.length < LIST_PAGE_SIZE) break;
    }
    return entries;
  }

  /** Deletes in batches; returns how many were removed. Non-fatal per batch. */
  private async removeObjects(paths: string[]): Promise<number> {
    let deleted = 0;
    for (let i = 0; i < paths.length; i += DELETE_BATCH_SIZE) {
      const batch = paths.slice(i, i + DELETE_BATCH_SIZE);
      const { error } = await this.storage.storage.from(DESIGN_ASSETS_BUCKET).remove(batch);
      if (error) {
        // One failed batch shouldn't abort the run — log and keep going so the
        // rest of the orphans are still reclaimed.
        this.logger.warn(`Could not delete a batch of ${batch.length} objects: ${error.message}`);
        continue;
      }
      deleted += batch.length;
    }
    return deleted;
  }
}

/** Adds every design-assets path found in `text` to `paths` (decoded). */
function addExtractedPaths(paths: Set<string>, text: string): void {
  for (const match of text.matchAll(ASSET_PATH_RE)) {
    const raw = match[1];
    if (!raw) continue;
    try {
      paths.add(decodeURIComponent(raw));
    } catch {
      paths.add(raw); // malformed %-escape — keep the literal, still a valid guard
    }
  }
}
