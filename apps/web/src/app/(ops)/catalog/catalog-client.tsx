"use client";

import { useState } from "react";
import { DEFAULT_CARD_SIZE, cardSizeDimensions, idealArtworkPixels } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { SuperAdminEditable } from "../ops-role";

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
  /** Product codes on more than one card — report noise, not corruption. */
  duplicateSkus?: { sku: string; designs: { externalId: string; title: string }[] }[];
  /** Names that collide on the URL slug. Permanent: a slug is assigned once. */
  duplicateNames?: { slug: string; designs: { externalId: string; title: string }[] }[];
  /** Upstream categories with no published landing page. */
  unpublishedCategories?: { category: string; count: number }[];
  /** Designs whose artwork is not the card's shape, so part of it is cut off to
   *  make it fit — worst first. See docs/card-artwork-crop-plan.md. */
  cropped?: {
    externalId: string;
    sku: string | null;
    title: string;
    percent: number;
    axis: "width" | "height";
    verdict: "noticeable" | "heavy";
    width?: number;
    height?: number;
  }[];
  fieldMapping?: {
    fields: Record<string, CatalogFieldResolution>;
    columns: string[];
  };
  /** Whether the public marketing library was refreshed too — see below. */
  published?: { outcome: "published" | "not-configured" | "failed"; reason?: string };
}

/**
 * Above this many designs losing the identical amount, the names stop being the
 * useful part and start being a wall to scroll past — the group line already
 * says everything that can be acted on.
 */
const NAMED_GROUP_LIMIT = 8;

type CroppedDesign = NonNullable<CatalogSyncSummary["cropped"]>[number];

/**
 * Collapse designs losing the same amount off the same axis into one row.
 *
 * The first real sync returned 207 of 217 designs at an identical "6% of the
 * height" — one wrong export preset, applied 207 times. Printed one per line
 * that reads as 207 separate problems and gets scrolled past; printed once it
 * reads as the single thing it is.
 */
function groupCropped(cropped: CroppedDesign[]): {
  key: string;
  percent: number;
  axis: string;
  verdict: string;
  source: string | null;
  designs: CroppedDesign[];
}[] {
  const groups = new Map<string, CroppedDesign[]>();
  for (const design of cropped) {
    const key = `${design.percent}:${design.axis}`;
    groups.set(key, [...(groups.get(key) ?? []), design]);
  }
  return Array.from(groups.entries()).map(([key, designs]) => {
    const first = designs[0]!;
    // Only claim a source shape when the whole group shares one; a group can
    // hold several sizes that happen to round to the same percentage.
    const sizes = new Set(
      designs.map((d) => (d.width && d.height ? `${d.width} × ${d.height}` : "")),
    );
    return {
      key,
      percent: first.percent,
      axis: first.axis,
      verdict: designs.some((d) => d.verdict === "heavy") ? "heavy" : "noticeable",
      source:
        sizes.size === 1 ? (designs[0]!.width ? `${first.width} × ${first.height}` : null) : null,
      designs,
    };
  });
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

export function CatalogClient({
  configured,
  cropGateEnabled = false,
}: {
  configured: boolean;
  cropGateEnabled?: boolean;
}) {
  const [syncing, setSyncing] = useState(false);
  const [summary, setSummary] = useState<CatalogSyncSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gateOn, setGateOn] = useState(cropGateEnabled);
  const [gateSaving, setGateSaving] = useState(false);

  async function setGate(enabled: boolean) {
    setError(null);
    setGateSaving(true);
    // Optimistic, then corrected by what the server says it stored — a toggle
    // that lags a round trip invites a second click and a race.
    setGateOn(enabled);
    try {
      const result = await clientApiFetch<{ enabled: boolean }>("/catalog/crop-gate", {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      });
      setGateOn(result.enabled);
    } catch (gateError) {
      setGateOn(!enabled);
      setError(gateError instanceof ApiError ? gateError.message : "Could not change the setting");
    } finally {
      setGateSaving(false);
    }
  }

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
          Airtable isn’t connected yet. Set <code>AIRTABLE_API_KEY</code> and{" "}
          <code>AIRTABLE_BASE_ID</code> on the API service, then reload this page.
        </p>
      )}

      {/* The refusal the crop plan reserved for the sync. Off until the catalog
          is re-exported at 1240 × 1748 — closing it today would reject 207 of
          217 designs and empty the library — and on afterwards, so the problem
          cannot come back. A runtime setting precisely so there is no window
          where the gate is on and the artwork is not ready.
          See docs/card-artwork-shape-plan.md, Phase 5. */}
      <div className="flex flex-col gap-2 rounded-lg border border-black/10 p-4">
        <span className="text-sm font-semibold">Refuse artwork that would be cropped</span>
        <p className="text-xs text-foreground/60">
          When this is on, a card whose artwork is not the card’s shape is not imported: it keeps
          the artwork it already had and the sync says so. Leave it off until every design has been
          re-exported at {idealArtworkPixels(DEFAULT_CARD_SIZE).width} ×{" "}
          {idealArtworkPixels(DEFAULT_CARD_SIZE).height} — switching it on before then would turn
          away almost the whole catalog.
        </p>
        <SuperAdminEditable>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={gateOn}
              disabled={gateSaving}
              onChange={(e) => void setGate(e.target.checked)}
              className="h-4 w-4"
            />
            {gateOn ? "On — cropped artwork is refused" : "Off — cropped artwork is imported"}
          </label>
        </SuperAdminEditable>
      </div>

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
            <li>Artwork being cropped: {summary.cropped?.length ?? 0}</li>
            <li>Shared product codes: {summary.duplicateSkus?.length ?? 0}</li>
            <li>Clashing card names: {summary.duplicateNames?.length ?? 0}</li>
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
                    Synced, but the public card library wasn’t refreshed.
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
                The text on these cards is current — only the new image couldn’t be stored. The
                library accepts PNG, JPEG, WebP and GIF up to 10MB, so a HEIC straight off a phone
                or an oversized print file will fail here. Re-export and re-attach in Airtable, then
                sync again.
              </p>
              {summary.artworkFailed.map((c) => (
                <p key={c.externalId} className="text-xs text-foreground/60">
                  {c.title}
                  {c.sku ? ` (${c.sku})` : ""} — {c.reason}
                </p>
              ))}
            </div>
          )}
          {/* Which of our designs are being cut up — a question that had no
              answer at all until the sync started measuring, and whose first
              answer was 207 designs at an identical 6%. That is one wrong export
              preset applied 207 times, not 207 problems, and a list that prints
              it 207 times says the opposite. Grouped by what is actually lost;
              named individually only where the group is small enough for the
              names to be the useful part. See docs/card-artwork-shape-plan.md. */}
          {summary.cropped && summary.cropped.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-black/10 pt-2">
              <p className="font-medium text-amber-600">
                Imported, but part of the artwork is cut off:
              </p>
              <p className="text-xs text-foreground/60">
                A card is {cardSizeDimensions(DEFAULT_CARD_SIZE)} and a background fills it edge to
                edge, centred and cropped — so artwork of any other shape loses its sides or its top
                and bottom. Re-export at{" "}
                <span className="font-medium">
                  {idealArtworkPixels(DEFAULT_CARD_SIZE).width} ×{" "}
                  {idealArtworkPixels(DEFAULT_CARD_SIZE).height}
                </span>{" "}
                and re-attach in Airtable: that is the card’s own proportion at 300dpi, so it clears
                this check and the resolution check together.
              </p>
              {groupCropped(summary.cropped).map((group) => (
                <div key={group.key} className="flex flex-col gap-0.5">
                  <p className="text-xs">
                    <span
                      className={
                        group.verdict === "heavy"
                          ? "font-medium text-amber-700"
                          : "font-medium text-foreground/70"
                      }
                    >
                      {group.designs.length === 1
                        ? `1 design loses ${group.percent}% of its ${group.axis}`
                        : `${group.designs.length} designs lose ${group.percent}% of their ${group.axis}`}
                    </span>
                    <span className="text-foreground/60">
                      {group.source ? ` — artwork is ${group.source}` : ""}
                    </span>
                  </p>
                  {group.designs.length <= NAMED_GROUP_LIMIT &&
                    group.designs.map((c) => (
                      <p key={c.externalId} className="pl-3 text-xs text-foreground/60">
                        {c.title}
                        {c.sku ? ` (${c.sku})` : ""}
                      </p>
                    ))}
                </div>
              ))}
            </div>
          )}
          {/* What the catalog *data* can be wrong about, as opposed to its
              artwork. None of this corrupts anything — all three are fixed in
              Airtable — which is exactly why none of it was visible until the
              sync started saying so. See docs/card-artwork-shape-plan.md. */}
          {summary.duplicateSkus && summary.duplicateSkus.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-black/10 pt-2">
              <p className="font-medium text-amber-600">One product code, more than one card:</p>
              <p className="text-xs text-foreground/60">
                Nothing is keyed on the code, so no card is broken. But every list on this page
                reads “Title (SKU)”, and the re-export list above is handed to somebody as codes to
                work through — two cards on one code cannot be worked from.
              </p>
              {summary.duplicateSkus.map((group) => (
                <p key={group.sku} className="text-xs text-foreground/60">
                  <span className="font-medium text-foreground/70">{group.sku}</span> —{" "}
                  {group.designs.map((d) => d.title).join(", ")}
                </p>
              ))}
            </div>
          )}
          {summary.duplicateNames && summary.duplicateNames.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-black/10 pt-2">
              <p className="font-medium text-amber-600">Two cards, one address:</p>
              <p className="text-xs text-foreground/60">
                A card’s URL comes from its name and is assigned once, never recalculated — changing
                it would break indexed links and the QR codes on cards already posted. So the second
                card to claim a name keeps a <code>-2</code> on the end of its address for good,
                even if it is renamed later. Worth fixing before these are published.
              </p>
              {summary.duplicateNames.map((group) => (
                <p key={group.slug} className="text-xs text-foreground/60">
                  <span className="font-medium text-foreground/70">/{group.slug}</span> —{" "}
                  {group.designs.map((d) => d.title).join(", ")}
                </p>
              ))}
            </div>
          )}
          {summary.unpublishedCategories && summary.unpublishedCategories.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-black/10 pt-2">
              <p className="font-medium">Categories with no landing page</p>
              <p className="text-xs text-foreground/60">
                These cards are fine — they sync, they browse, and their own pages are indexable.
                They just sit under <code>/cards/other</code>, which is deliberately not indexed, so
                there is no category page for anyone to search for. Either the category is worth
                naming properly or the upstream value needs correcting.
              </p>
              {summary.unpublishedCategories.map((entry) => (
                <p key={entry.category} className="text-xs text-foreground/60">
                  <span className="font-medium text-foreground/70">{entry.category}</span> —{" "}
                  {entry.count} card{entry.count === 1 ? "" : "s"}
                </p>
              ))}
            </div>
          )}
          {summary.fieldMapping && (
            <div className="flex flex-col gap-1 border-t border-black/10 pt-2">
              <p className="font-medium">Columns read from Airtable</p>
              <p className="text-xs text-foreground/60">
                Column names aren’t fixed in code — the sync takes the first one it recognises. If a
                card’s name looks wrong and editing it changes nothing, it’s almost always because
                the sync is reading a different column from the one being edited.
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
              <p className="font-medium text-red-600">Cards that didn’t import:</p>
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
