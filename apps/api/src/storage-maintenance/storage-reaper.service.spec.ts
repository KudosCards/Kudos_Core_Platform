import type { ConfigService } from "@nestjs/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PrismaService } from "../prisma/prisma.service";
import { StorageReaperService } from "./storage-reaper.service";

/**
 * A minimal Supabase storage double. Seed it with a flat list of objects keyed
 * by full path; it serves them back through the folder-at-a-time `list` API the
 * reaper walks, and records what `remove` was asked to delete.
 */
function buildStorage(objects: { path: string; createdAt: string | null }[]): {
  client: SupabaseClient;
  removed: string[];
} {
  const removed: string[] = [];

  function list(prefix: string): { data: unknown[]; error: null } {
    if (prefix === "") {
      // Top level: distinct first path segments. A segment with children is a
      // folder (null id); a bare file at root keeps its metadata.
      const seen = new Map<string, { isDir: boolean; createdAt: string | null }>();
      for (const o of objects) {
        const slash = o.path.indexOf("/");
        if (slash === -1) {
          seen.set(o.path, { isDir: false, createdAt: o.createdAt });
        } else {
          const dir = o.path.slice(0, slash);
          if (!seen.has(dir)) seen.set(dir, { isDir: true, createdAt: null });
        }
      }
      return {
        data: [...seen.entries()].map(([name, meta]) => ({
          name,
          id: meta.isDir ? null : "file-id",
          created_at: meta.createdAt,
        })),
        error: null,
      };
    }
    // Inside a folder: the files directly under `${prefix}/`.
    const inside = objects
      .filter((o) => o.path.startsWith(`${prefix}/`))
      .map((o) => ({
        name: o.path.slice(prefix.length + 1),
        id: "file-id",
        created_at: o.createdAt,
      }));
    return { data: inside, error: null };
  }

  const client = {
    storage: {
      from: () => ({
        list: (prefix: string) => Promise.resolve(list(prefix)),
        remove: (paths: string[]) => {
          removed.push(...paths);
          return Promise.resolve({ data: paths.map((p) => ({ name: p })), error: null });
        },
      }),
    },
  } as unknown as SupabaseClient;

  return { client, removed };
}

function buildConfig(values: { enabled: boolean; graceDays: number }): ConfigService<never, true> {
  return {
    // Mirrors the env: a plain string flag ("true"/undefined) the service reads live.
    get: (key: string) =>
      key === "STORAGE_REAPER_ENABLED" ? (values.enabled ? "true" : undefined) : values.graceDays,
  } as unknown as ConfigService<never, true>;
}

function buildPrisma(seed: {
  assets?: { url: string }[];
  cardDesigns?: { thumbnailUrl: string; document: unknown }[];
  savedDesigns?: { document: unknown }[];
}): PrismaService {
  return {
    designAsset: { findMany: () => Promise.resolve(seed.assets ?? []) },
    cardDesign: { findMany: () => Promise.resolve(seed.cardDesigns ?? []) },
    savedDesign: { findMany: () => Promise.resolve(seed.savedDesigns ?? []) },
  } as unknown as PrismaService;
}

const ACCOUNT = "acc-1";
const OLD = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const RECENT = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
const publicUrl = (path: string) =>
  `https://x.supabase.co/storage/v1/object/public/design-assets/${path}`;

describe("StorageReaperService", () => {
  it("deletes an unreferenced object that's past the grace window", async () => {
    const orphan = `${ACCOUNT}/orphan.png`;
    const storage = buildStorage([{ path: orphan, createdAt: OLD }]);
    const service = new StorageReaperService(
      buildPrisma({}),
      buildConfig({ enabled: true, graceDays: 7 }),
      storage.client,
    );

    const summary = await service.reap();

    expect(summary.orphaned).toBe(1);
    expect(summary.deleted).toBe(1);
    expect(summary.dryRun).toBe(false);
    expect(storage.removed).toEqual([orphan]);
  });

  it("keeps an object referenced by a DesignAsset url", async () => {
    const kept = `${ACCOUNT}/kept.png`;
    const storage = buildStorage([{ path: kept, createdAt: OLD }]);
    const service = new StorageReaperService(
      buildPrisma({ assets: [{ url: publicUrl(kept) }] }),
      buildConfig({ enabled: true, graceDays: 7 }),
      storage.client,
    );

    const summary = await service.reap();

    expect(summary.referenced).toBe(1);
    expect(summary.orphaned).toBe(0);
    expect(storage.removed).toEqual([]);
  });

  it("keeps an object embedded inside a SavedDesign document", async () => {
    const kept = `${ACCOUNT}/in-doc.png`;
    const storage = buildStorage([{ path: kept, createdAt: OLD }]);
    const document = { elements: [{ type: "image", src: publicUrl(kept) }] };
    const service = new StorageReaperService(
      buildPrisma({ savedDesigns: [{ document }] }),
      buildConfig({ enabled: true, graceDays: 7 }),
      storage.client,
    );

    const summary = await service.reap();

    expect(summary.orphaned).toBe(0);
    expect(storage.removed).toEqual([]);
  });

  it("keeps an unreferenced object still inside the grace window", async () => {
    const recent = `${ACCOUNT}/just-uploaded.png`;
    const storage = buildStorage([{ path: recent, createdAt: RECENT }]);
    const service = new StorageReaperService(
      buildPrisma({}),
      buildConfig({ enabled: true, graceDays: 7 }),
      storage.client,
    );

    const summary = await service.reap();

    expect(summary.recentlyUploaded).toBe(1);
    expect(summary.orphaned).toBe(0);
    expect(storage.removed).toEqual([]);
  });

  it("never reaps catalog artwork, even when unreferenced", async () => {
    const storage = buildStorage([{ path: "catalog/rec123.png", createdAt: OLD }]);
    const service = new StorageReaperService(
      buildPrisma({}),
      buildConfig({ enabled: true, graceDays: 7 }),
      storage.client,
    );

    const summary = await service.reap();

    expect(summary.scanned).toBe(0); // catalog folder is skipped entirely
    expect(storage.removed).toEqual([]);
  });

  it("reports orphans but deletes nothing on an explicit dry run", async () => {
    const orphan = `${ACCOUNT}/orphan.png`;
    const storage = buildStorage([{ path: orphan, createdAt: OLD }]);
    const service = new StorageReaperService(
      buildPrisma({}),
      buildConfig({ enabled: true, graceDays: 7 }),
      storage.client,
    );

    const summary = await service.reap({ dryRun: true });

    expect(summary.orphaned).toBe(1);
    expect(summary.deleted).toBe(0);
    expect(summary.dryRun).toBe(true);
    expect(storage.removed).toEqual([]);
  });

  it("deletes nothing when the feature is disabled", async () => {
    const orphan = `${ACCOUNT}/orphan.png`;
    const storage = buildStorage([{ path: orphan, createdAt: OLD }]);
    const service = new StorageReaperService(
      buildPrisma({}),
      buildConfig({ enabled: false, graceDays: 7 }),
      storage.client,
    );

    const summary = await service.reap();

    expect(summary.orphaned).toBe(1); // still identified…
    expect(summary.deleted).toBe(0); // …but never removed
    expect(summary.dryRun).toBe(true);
    expect(storage.removed).toEqual([]);
  });
});
