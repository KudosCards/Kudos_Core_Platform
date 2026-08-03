"use client";

import { useRef, useState, type ChangeEvent } from "react";
import {
  CSV_IMPORT_FIELDS,
  type CsvColumnMapping,
  type CsvImportField,
  type CsvImportPreview,
} from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

export interface ImportSummary {
  created: number;
  updated: number;
  rejected: { row: number; reason: string }[];
  warnings: { row: number; message: string }[];
}

/** Canonical headers for the downloadable template — matches the API's row parser. */
const SAMPLE_CSV = [
  "firstName,lastName,dateOfBirth,addressLine1,addressLine2,addressCity,postcode,email",
  "Ada,Lovelace,10/12/1815,12 Analytical Way,,London,SW1A 1AA,ada@example.com",
].join("\n");

function downloadSampleCsv() {
  const blob = new Blob([SAMPLE_CSV], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "kudos-contacts-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

const inputClass = "rounded-md border border-border bg-surface px-3 py-2 text-sm";

/** The value the "not in my file" option uses (empty string = unmapped). */
const UNMAPPED = "";

/**
 * The full contacts-CSV import flow: pick a file → we detect its columns and
 * suggest a mapping → the user confirms/adjusts which column feeds each field →
 * import. The customer never has to rename their spreadsheet headers to match
 * ours. Used by both the recipients page and the get-started wizard. See ADR 0078.
 */
export function CsvImport({ onImported }: { onImported?: (summary: ImportSummary) => void }) {
  const [preview, setPreview] = useState<CsvImportPreview | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<CsvColumnMapping>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setPreview(null);
    setFile(null);
    setMapping({});
    setError(null);
    setSummary(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    if (!chosen) return;
    setError(null);
    setSummary(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", chosen);
      const result = await clientApiFetch<CsvImportPreview>("/recipients/import/preview", {
        method: "POST",
        body: form,
      });
      setFile(chosen);
      setPreview(result);
      setMapping(result.suggestedMapping);
    } catch (previewError) {
      setError(
        previewError instanceof ApiError ? previewError.message : "Could not read that CSV file.",
      );
      reset();
    } finally {
      setBusy(false);
    }
  }

  function setFieldColumn(field: CsvImportField, column: string) {
    setMapping((current) => {
      const next = { ...current };
      if (column === UNMAPPED) delete next[field];
      else next[field] = column;
      return next;
    });
  }

  const requiredMissing = CSV_IMPORT_FIELDS.filter((f) => f.required && !mapping[f.key]);

  async function handleImport() {
    if (!file || requiredMissing.length > 0) return;
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("mapping", JSON.stringify(mapping));
      const result = await clientApiFetch<ImportSummary>("/recipients/import", {
        method: "POST",
        body: form,
      });
      setSummary(result);
      setPreview(null);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onImported?.(result);
    } catch (importError) {
      setError(importError instanceof ApiError ? importError.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  // Step 1 — choose a file (also shown after a completed import, to add more).
  if (!preview) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted">
          Upload any CSV — exported from a spreadsheet, your HR system, or another tool. We&apos;ll
          detect the columns and let you match them to the right fields, so you don&apos;t need to
          rename anything first.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => void handleFile(event)}
          disabled={busy}
          aria-label="Choose a CSV file"
          className="block w-full cursor-pointer rounded-md border border-border bg-surface text-sm text-muted file:mr-3 file:cursor-pointer file:border-0 file:bg-accent file:px-4 file:py-2 file:font-medium file:text-white hover:file:bg-accent-hover disabled:opacity-50"
        />
        {busy && <p className="text-sm text-muted">Reading your file…</p>}
        {error && (
          <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">
            {error}
          </p>
        )}
        {summary && (
          <div className="flex flex-col gap-2">
            <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800">
              Imported {summary.created} new, updated {summary.updated}
              {summary.warnings.length > 0 && `, ${summary.warnings.length} with a field skipped`}
              {summary.rejected.length > 0 && `, skipped ${summary.rejected.length}`}.
            </p>
            {summary.rejected.length > 0 && (
              <details className="rounded-lg border border-border px-4 py-2 text-sm">
                <summary className="cursor-pointer font-medium text-accent">
                  {summary.rejected.length} row{summary.rejected.length === 1 ? "" : "s"} couldn&apos;t
                  be imported — see why
                </summary>
                <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-xs text-muted">
                  {summary.rejected.slice(0, 20).map((r) => (
                    <li key={`r-${r.row}`}>
                      Row {r.row}: {r.reason}
                    </li>
                  ))}
                  {summary.rejected.length > 20 && <li>…and {summary.rejected.length - 20} more</li>}
                </ul>
              </details>
            )}
            {summary.warnings.length > 0 && (
              <details className="rounded-lg border border-border px-4 py-2 text-sm">
                <summary className="cursor-pointer font-medium">
                  {summary.warnings.length} contact{summary.warnings.length === 1 ? "" : "s"} imported
                  with a field skipped — see details
                </summary>
                <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-xs text-muted">
                  {summary.warnings.slice(0, 20).map((w, i) => (
                    <li key={`w-${w.row}-${i}`}>
                      Row {w.row}: {w.message}
                    </li>
                  ))}
                  {summary.warnings.length > 20 && <li>…and {summary.warnings.length - 20} more</li>}
                </ul>
              </details>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={downloadSampleCsv}
          className="self-start text-xs text-muted underline hover:text-foreground"
        >
          Need a template? Download a sample CSV
        </button>
      </div>
    );
  }

  // Step 2 — map columns and confirm.
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="font-semibold">{preview.totalRows}</span> contact
          {preview.totalRows === 1 ? "" : "s"} found in{" "}
          <span className="font-medium">{file?.name}</span>. Match your columns to our fields:
        </p>
        <button type="button" onClick={reset} className="text-xs text-muted underline hover:text-foreground">
          Choose a different file
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {CSV_IMPORT_FIELDS.map((field) => (
          <label key={field.key} className="flex flex-col gap-1 text-sm">
            <span className="font-medium">
              {field.label}
              {field.required && <span className="ml-1 text-accent">*</span>}
            </span>
            <select
              value={mapping[field.key] ?? UNMAPPED}
              onChange={(event) => setFieldColumn(field.key, event.target.value)}
              className={`${inputClass} ${field.required && !mapping[field.key] ? "border-accent" : ""}`}
            >
              <option value={UNMAPPED}>
                {field.required ? "— Select a column —" : "— Not in my file —"}
              </option>
              {preview.columns.map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {preview.sampleRows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border bg-foreground/[0.02]">
                {preview.columns.map((column) => (
                  <th key={column} className="whitespace-nowrap px-3 py-2 font-medium text-muted">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.sampleRows.map((row, index) => (
                <tr key={index} className="border-b border-border last:border-0">
                  {preview.columns.map((column) => (
                    <td key={column} className="whitespace-nowrap px-3 py-2 text-muted">
                      {row[column]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {requiredMissing.length > 0 && (
        <p className="text-xs text-muted">
          Choose a column for {requiredMissing.map((f) => f.label.toLowerCase()).join(" and ")} to
          continue — everything else is optional.
        </p>
      )}

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void handleImport()}
          disabled={busy || requiredMissing.length > 0}
          className="btn-accent self-start disabled:opacity-50"
        >
          {busy ? "Importing…" : `Import ${preview.totalRows} contact${preview.totalRows === 1 ? "" : "s"}`}
        </button>
        <p className="text-xs text-muted">
          Contacts without a full address still import — we&apos;ll flag them as &ldquo;needs
          address&rdquo;.
        </p>
      </div>
    </div>
  );
}
