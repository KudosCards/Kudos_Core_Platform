"use client";

import type { Recipient } from "@kudos/shared-types";
import { useCallback, useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

export const PER_PAGE = 100;

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

  const reload = useCallback(async (targetPage: number) => {
    const result = await clientApiFetch<Paginated<Recipient>>(
      `/recipients?page=${targetPage}&perPage=${PER_PAGE}`,
    );
    setRecipients(result.items);
    setTotal(result.total);
    setPage(targetPage);
  }, []);

  async function handleAddRecipient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const firstName = String(formData.get("firstName"));
    const lastName = String(formData.get("lastName"));
    const dateOfBirth = String(formData.get("dateOfBirth") || "");
    const addressPostcode = String(formData.get("addressPostcode") || "");

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

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Recipients</h1>
        <p className="text-foreground/60">{total} total</p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="grid gap-8 lg:grid-cols-2">
        <form
          onSubmit={(event) => void handleAddRecipient(event)}
          className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
        >
          <h2 className="font-semibold">Add a recipient</h2>
          <div className="grid grid-cols-2 gap-3">
            <input
              name="firstName"
              placeholder="First name"
              required
              className="rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10"
            />
            <input
              name="lastName"
              placeholder="Last name"
              required
              className="rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10"
            />
            <input
              type="date"
              name="dateOfBirth"
              className="rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10"
            />
            <input
              name="addressPostcode"
              placeholder="Postcode"
              className="rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10"
            />
          </div>
          <button
            type="submit"
            className="self-start rounded-full bg-foreground px-4 py-2 text-sm text-background hover:opacity-90"
          >
            Add recipient
          </button>
        </form>

        <form
          onSubmit={(event) => void handleImport(event)}
          className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
        >
          <h2 className="font-semibold">Import from CSV</h2>
          <p className="text-xs text-foreground/60">
            Columns: firstName, lastName, dateOfBirth (dd/mm/yyyy), postcode, email
          </p>
          <input type="file" name="file" accept=".csv" required className="text-sm" />
          <button
            type="submit"
            className="self-start rounded-full border border-black/20 px-4 py-2 text-sm hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/5"
          >
            Import
          </button>
          {importSummary && (
            <p className="text-sm text-foreground/70">
              Created {importSummary.created}, updated {importSummary.updated}
              {importSummary.rejected.length > 0 && `, rejected ${importSummary.rejected.length}`}
            </p>
          )}
        </form>
      </section>

      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-black/10 text-foreground/60 dark:border-white/10">
            <th className="py-2 font-medium">Name</th>
            <th className="py-2 font-medium">Date of birth</th>
            <th className="py-2 font-medium">Postcode</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {recipients.length === 0 ? (
            <tr>
              <td colSpan={4} className="py-4 text-foreground/60">
                No recipients yet.
              </td>
            </tr>
          ) : (
            recipients.map((recipient) => (
              <tr key={recipient.id} className="border-b border-black/5 dark:border-white/5">
                <td className="py-2">
                  {recipient.firstName} {recipient.lastName}
                </td>
                <td className="py-2">
                  {recipient.dateOfBirth
                    ? new Date(recipient.dateOfBirth).toLocaleDateString("en-GB")
                    : "—"}
                </td>
                <td className="py-2">{recipient.addressPostcode ?? "—"}</td>
                <td className="py-2">{recipient.status}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {total > PER_PAGE && (
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => void reload(page - 1)}
            className="rounded-full border border-black/20 px-4 py-2 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/5"
          >
            Previous
          </button>
          <span className="text-foreground/60">
            Page {page} of {Math.max(1, Math.ceil(total / PER_PAGE))}
          </span>
          <button
            type="button"
            disabled={page * PER_PAGE >= total}
            onClick={() => void reload(page + 1)}
            className="rounded-full border border-black/20 px-4 py-2 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/20 dark:hover:bg-white/5"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
