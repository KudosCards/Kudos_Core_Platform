"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

interface CatalogFieldResolution {
  /** The Airtable column the sync read, or null if none matched. */
  using: string | null;
  /** Other aliased columns that also hold a value — an edit in one of these
   *  is being ignored. */
  alsoPresent: string[];
}

interface CatalogSyncSummary {
  fetched: number;
  created: number;
  updated: number;
  deactivated: number;
  imagesCopied: number;
  skippedNoImage: { externalId: string; sku: string | null; title: string }[];
  artworkFailed: { externalId: string; sku: string | null; title: string; reason: string }[];
  errors: { externalId: string; sku: string | null; reason: string }[];
  fieldMapping?: {
    fields: Record<string, CatalogFieldResolution>;
    columns: string[];
  };
  /** Whether the public marketing library was refreshed too — see below. */
  published?: { outcome: "published" | "not-configured" | "failed"; reason?: string };
}

/** Which logical fields are worth showing, and what to call them. */
const FIELD_LABELS: Record<string, string> = {
  title: "Card name",
  category: "Occasion",
  sku: "SKU",
  frontImage: "Artwork",
  insideMessage: "Inside message",
  status: "Status",
};

export function CatalogClient({ configured }: { configured: boolean }) {
  const [syncing, setSyncing] = useState(false);
  const [summary, setSummary] = useState<CatalogSyncSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    setSummary(null);
    setSyncing(true);
    try {
      const result = await clientApiFetch<CatalogSyncSummary>("/catalog/sync", { method: "POST" });
      setSummary(result);
    } catch (syncError) {
      setError(syncError instanceof ApiError ? syncError.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Card catalog</h1>
        <p className="text-foreground/60">
          Pull the latest card designs from Airtable into the platform. Only cards marked{" "}
          <span className="font-medium">Active</span>{" "}
          <span className="font-medium">with artwork attached</span> are imported; retired cards —
          and any without an image — are hidden automatically.
        </p>
      </div>

      {!configured && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700">
          Airtable isn&apos;t connected yet. Set <code>AIRTABLE_API_KEY</code> and{" "}
          <code>AIRTABLE_BASE_ID</code> on the API service, then reload this page.
        </p>
      )}

      <div>
        <button
          type="button"
          disabled={syncing || !configured}
          onClick={() => void refresh()}
          className="rounded-full bg-foreground px-5 py-2 text-sm text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {syncing ? "Syncing…" : "Refresh catalog from Airtable"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {summary && (
        <div className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 text-sm">
          <p className="font-medium">Sync complete</p>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-foreground/70 sm:grid-cols-3">
            <li>Fetched: {summary.fetched}</li>
            <li>Created: {summary.created}</li>
            <li>Updated: {summary.updated}</li>
            <li>Deactivated: {summary.deactivated}</li>
            <li>Images copied: {summary.imagesCopied}</li>
            <li>No image (skipped): {summary.skippedNoImage.length}</li>
            <li>Artwork not copied: {summary.artworkFailed?.length ?? 0}</li>
            <li>Errors: {summary.errors.length}</li>
          </ul>

          {/* "Synced" and "live on the website" are two different things.
              Signed-in pages read the catalog uncached so they update at once;
              /cards is served from an hourly cache and only changes when it's
              told to. Saying so is the difference between "it's on its way" and
              an hour of wondering whether the sync worked. */}
          {summary.published && (
            <div className="border-t border-black/10 pt-2">
              {summary.published.outcome === "published" ? (
                <p className="text-emerald-700">
                  Public card library refreshed — the changes are live on the website now.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  <p className="font-medium text-amber-600">
                    Synced, but the public card library wasn&rsquo;t refreshed.
                  </p>
                  <p className="text-xs text-foreground/60">
                    {summary.published.reason ??
                      "The website will pick the changes up within the hour on its own."}
                  </p>
                </div>
              )}
            </div>
          )}
          {summary.skippedNoImage.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-black/10 pt-2">
              <p className="font-medium text-amber-600">
                Not shown — no artwork attached in Airtable:
              </p>
              {summary.skippedNoImage.map((c) => (
                <p key={c.externalId} className="text-xs text-foreground/60">
                  {c.title}
                  {c.sku ? ` (${c.sku})` : ""}
                </p>
              ))}
            </div>
          )}
          {summary.artworkFailed?.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-black/10 pt-2">
              <p className="font-medium text-amber-600">
                Updated, but still showing their previous artwork:
              </p>
              <p className="text-xs text-foreground/60">
                The text on these cards is current — only the new image couldn&rsquo;t be stored.
                The library accepts PNG, JPEG, WebP and GIF up to 10MB, so a HEIC straight off a
                phone or an oversized print file will fail here. Re-export and re-attach in
                Airtable, then sync again.
              </p>
              {summary.artworkFailed.map((c) => (
                <p key={c.externalId} className="text-xs text-foreground/60">
                  {c.title}
                  {c.sku ? ` (${c.sku})` : ""} — {c.reason}
                </p>
              ))}
            </div>
          )}
          {summary.fieldMapping && (
            <div className="flex flex-col gap-1 border-t border-black/10 pt-2">
              <p className="font-medium">Columns read from Airtable</p>
              <p className="text-xs text-foreground/60">
                Column names aren&rsquo;t fixed in code — the sync takes the first one it
                recognises. If a card&rsquo;s name looks wrong and editing it changes nothing,
                it&rsquo;s almost always because the sync is reading a different column from the one
                being edited.
              </p>
              {Object.entries(summary.fieldMapping.fields).map(([field, resolution]) => (
                <p key={field} className="text-xs text-foreground/70">
                  <span className="text-foreground/50">{FIELD_LABELS[field] ?? field}:</span>{" "}
                  {resolution.using ? (
                    <span className="font-medium">{resolution.using}</span>
                  ) : (
                    <span className="text-foreground/40">no matching column</span>
                  )}
                  {resolution.alsoPresent.length > 0 && (
                    <span className="text-amber-600">
                      {" "}
                      — ignoring {resolution.alsoPresent.join(", ")}
                    </span>
                  )}
                </p>
              ))}
            </div>
          )}
          {summary.errors.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-black/10 pt-2">
              <p className="font-medium text-red-600">Cards that didn&apos;t import:</p>
              {summary.errors.map((e) => (
                <p key={e.externalId} className="text-xs text-foreground/60">
                  {e.sku ?? e.externalId}: {e.reason}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
