"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

/** Mirrors the API's ReapSummary (storage-reaper.service.ts). */
interface ReapSummary {
  dryRun: boolean;
  scanned: number;
  referenced: number;
  recentlyUploaded: number;
  orphaned: number;
  deleted: number;
  capped: boolean;
}

export function StorageClient({ enabled }: { enabled: boolean }) {
  const [running, setRunning] = useState<null | "preview" | "cleanup">(null);
  const [summary, setSummary] = useState<ReapSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(mode: "preview" | "cleanup") {
    setError(null);
    setSummary(null);
    setRunning(mode);
    try {
      // Preview is a dry run (report only); cleanup asks the server to actually
      // delete — which the server still ignores unless the reaper is enabled.
      const query = mode === "cleanup" ? "?dryRun=false" : "";
      const result = await clientApiFetch<ReapSummary>(`/storage-maintenance/reap${query}`, {
        method: "POST",
      });
      setSummary(result);
    } catch (runError) {
      setError(runError instanceof ApiError ? runError.message : "Storage cleanup failed");
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Storage cleanup</h1>
        <p className="text-foreground/60">
          Reclaims orphaned artwork from the design-assets storage bucket — files left behind by
          abandoned uploads or deleted library items that no card design uses anymore. It only ever
          deletes files referenced by <span className="font-medium">nothing</span>, older than a
          grace window, and never catalog artwork. See{" "}
          <span className="font-medium">docs/adr/0074</span>.
        </p>
      </div>

      {enabled ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-700">
          Cleanup is <span className="font-medium">enabled</span> — it also runs automatically each
          night. Always <span className="font-medium">Preview</span> first to see what would go.
        </p>
      ) : (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700">
          Cleanup is <span className="font-medium">off</span>. You can still{" "}
          <span className="font-medium">Preview</span> what would be reclaimed; nothing is deleted
          until <code>STORAGE_REAPER_ENABLED</code> is set on the API service.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={running !== null}
          onClick={() => void run("preview")}
          className="rounded-full border border-border px-5 py-2 text-sm font-medium hover:bg-foreground/[0.04] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running === "preview" ? "Previewing…" : "Preview cleanup (dry run)"}
        </button>
        <button
          type="button"
          disabled={running !== null || !enabled}
          onClick={() => void run("cleanup")}
          title={enabled ? undefined : "Enable STORAGE_REAPER_ENABLED to run a real cleanup"}
          className="rounded-full bg-foreground px-5 py-2 text-sm text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running === "cleanup" ? "Cleaning up…" : "Run cleanup"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {summary && (
        <div className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 text-sm">
          <p className="font-medium">
            {summary.dryRun
              ? "Preview — nothing was deleted"
              : `Cleanup complete — ${summary.deleted} file${summary.deleted === 1 ? "" : "s"} deleted`}
          </p>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-foreground/70 sm:grid-cols-3">
            <li>Files scanned: {summary.scanned}</li>
            <li>In use (kept): {summary.referenced}</li>
            <li>Too new (kept): {summary.recentlyUploaded}</li>
            <li>Orphaned: {summary.orphaned}</li>
            <li>Deleted: {summary.deleted}</li>
          </ul>
          {summary.dryRun && summary.orphaned > 0 && (
            <p className="border-t border-black/10 pt-2 text-xs text-foreground/60">
              {enabled
                ? `Run cleanup to delete ${summary.orphaned} orphaned file${summary.orphaned === 1 ? "" : "s"}.`
                : "These would be deleted once cleanup is enabled."}
            </p>
          )}
          {summary.capped && (
            <p className="border-t border-black/10 pt-2 text-xs text-amber-600">
              The per-run cap was hit — run again to reclaim the rest.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
