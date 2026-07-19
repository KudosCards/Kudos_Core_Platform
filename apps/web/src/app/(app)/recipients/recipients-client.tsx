"use client";

import type { Recipient } from "@kudos/shared-types";
import { useCallback, useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

export const PER_PAGE = 100;

/** Friendly labels for where a recipient came from (see the integrations spine). */
const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  csv: "CSV",
  api: "API",
  brevo: "Brevo",
  hubspot: "HubSpot",
  gohighlevel: "GoHighLevel",
};
function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

interface ImportSummary {
  created: number;
  updated: number;
  rejected: { row: number; reason: string }[];
}

export function RecipientsClient({
  initialRecipients,
  initialTotal,
  initialPage,
}: {
  initialRecipients: Recipient[];
  initialTotal: number;
  initialPage: number;
}) {
  const [recipients, setRecipients] = useState(initialRecipients);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [error, setError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [paginating, setPaginating] = useState(false);
  const [addingRecipient, setAddingRecipient] = useState(false);

  const reload = useCallback(async (targetPage: number) => {
    setPaginating(true);
    try {
      const result = await clientApiFetch<Paginated<Recipient>>(
        `/recipients?page=${targetPage}&perPage=${PER_PAGE}`,
      );
      setRecipients(result.items);
      setTotal(result.total);
      setPage(targetPage);
      setError(null);
    } catch (reloadError) {
      setError(reloadError instanceof ApiError ? reloadError.message : "Could not load recipients");
    } finally {
      setPaginating(false);
    }
  }, []);

  async function handleAddRecipient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const firstName = String(formData.get("firstName"));
    const lastName = String(formData.get("lastName"));
    const dateOfBirth = String(formData.get("dateOfBirth") || "");
    const addressPostcode = String(formData.get("addressPostcode") || "");

    // Recipients without a postcode/DOB have no distinguishing info, so the
    // DB's dedupe constraint can't catch a rapid double-submit (Postgres
    // treats NULL as always-distinct) — this guard is the only thing that does.
    setAddingRecipient(true);
    try {
      await clientApiFetch("/recipients", {
        method: "POST",
        body: JSON.stringify({
          firstName,
          lastName,
          ...(dateOfBirth && { dateOfBirth }),
          ...(addressPostcode && { addressPostcode }),
        }),
      });
      event.currentTarget.reset();
      await reload(1); // new recipients sort first (createdAt desc) — jump back to page 1 to see it
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : "Could not add recipient");
    } finally {
      setAddingRecipient(false);
    }
  }

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setImportSummary(null);
    const formData = new FormData(event.currentTarget);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a CSV file first");
      return;
    }

    const uploadData = new FormData();
    uploadData.set("file", file);

    try {
      const summary = await clientApiFetch<ImportSummary>("/recipients/import", {
        method: "POST",
        body: uploadData,
      });
      setImportSummary(summary);
      event.currentTarget.reset();
      await reload(1);
    } catch (importError) {
      setError(importError instanceof ApiError ? importError.message : "Import failed");
    }
  }

  const inputClass = "rounded-md border border-border bg-surface px-3 py-2 text-sm";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Recipients</h1>
        <p className="text-muted">{total} total</p>
      </div>

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
      )}

      <section className="grid gap-6 lg:grid-cols-2">
        <form
          onSubmit={(event) => void handleAddRecipient(event)}
          className="card flex flex-col gap-3 p-6"
        >
          <h2 className="font-semibold">Add a recipient</h2>
          <div className="grid grid-cols-2 gap-3">
            <input name="firstName" placeholder="First name" required className={inputClass} />
            <input name="lastName" placeholder="Last name" required className={inputClass} />
            <input type="date" name="dateOfBirth" className={inputClass} />
            <input name="addressPostcode" placeholder="Postcode" className={inputClass} />
          </div>
          <button type="submit" disabled={addingRecipient} className="btn-accent self-start">
            {addingRecipient ? "Adding…" : "Add recipient"}
          </button>
        </form>

        <form onSubmit={(event) => void handleImport(event)} className="card flex flex-col gap-3 p-6">
          <h2 className="font-semibold">Import from CSV</h2>
          <p className="text-xs text-muted">
            Columns: firstName, lastName, dateOfBirth (dd/mm/yyyy), postcode, email
          </p>
          <input type="file" name="file" accept=".csv" required className="text-sm" />
          <button type="submit" className="btn-secondary self-start">
            Import
          </button>
          {importSummary && (
            <p className="text-sm text-muted">
              Created {importSummary.created}, updated {importSummary.updated}
              {importSummary.rejected.length > 0 && `, rejected ${importSummary.rejected.length}`}
            </p>
          )}
        </form>
      </section>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="section-label px-5 py-3">Name</th>
              <th className="section-label px-5 py-3">Date of birth</th>
              <th className="section-label px-5 py-3">Postcode</th>
              <th className="section-label px-5 py-3">Source</th>
              <th className="section-label px-5 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {recipients.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-6 text-muted">
                  No recipients yet.
                </td>
              </tr>
            ) : (
              recipients.map((recipient) => {
                const fromIntegration =
                  recipient.source !== "manual" && recipient.source !== "csv";
                return (
                  <tr key={recipient.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3 font-medium">
                      {recipient.firstName} {recipient.lastName}
                    </td>
                    <td className="px-5 py-3 text-muted">
                      {recipient.dateOfBirth
                        ? new Date(recipient.dateOfBirth).toLocaleDateString("en-GB")
                        : "—"}
                    </td>
                    <td className="px-5 py-3 text-muted">{recipient.addressPostcode ?? "—"}</td>
                    <td className="px-5 py-3">
                      <span className={`pill ${fromIntegration ? "pill-accent" : "pill-muted"}`}>
                        {sourceLabel(recipient.source)}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="pill pill-muted capitalize">{recipient.status}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {total > PER_PAGE && (
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            disabled={page <= 1 || paginating}
            onClick={() => void reload(page - 1)}
            className="btn-secondary"
          >
            Previous
          </button>
          <span className="text-muted">
            Page {page} of {Math.max(1, Math.ceil(total / PER_PAGE))}
          </span>
          <button
            type="button"
            disabled={page * PER_PAGE >= total || paginating}
            onClick={() => void reload(page + 1)}
            className="btn-secondary"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
