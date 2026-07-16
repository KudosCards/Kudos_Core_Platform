"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

interface CatalogSyncSummary {
  fetched: number;
  created: number;
  updated: number;
  deactivated: number;
  imagesCopied: number;
  errors: { externalId: string; sku: string | null; reason: string }[];
}

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
          <span className="font-medium">Active</span> are imported; retired cards are hidden
          automatically.
        </p>
      </div>

      {!configured && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300">
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
        <div className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 text-sm dark:border-white/10">
          <p className="font-medium">Sync complete</p>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-foreground/70 sm:grid-cols-3">
            <li>Fetched: {summary.fetched}</li>
            <li>Created: {summary.created}</li>
            <li>Updated: {summary.updated}</li>
            <li>Deactivated: {summary.deactivated}</li>
            <li>Images copied: {summary.imagesCopied}</li>
            <li>Errors: {summary.errors.length}</li>
          </ul>
          {summary.errors.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-black/10 pt-2 dark:border-white/10">
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
