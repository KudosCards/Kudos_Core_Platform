"use client";

import type { Recipient, RecipientListSummary } from "@kudos/shared-types";
import Link from "next/link";
import { useCallback, useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { ConnectCrmCallout } from "@/components/connect-crm-callout";

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
  initialLists,
}: {
  initialRecipients: Recipient[];
  initialTotal: number;
  initialPage: number;
  initialLists: RecipientListSummary[];
}) {
  const [recipients, setRecipients] = useState(initialRecipients);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  const [error, setError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [paginating, setPaginating] = useState(false);
  const [addingRecipient, setAddingRecipient] = useState(false);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  // Lists state.
  const [lists, setLists] = useState<RecipientListSummary[]>(initialLists);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addToListId, setAddToListId] = useState<string>("");
  const [creatingList, setCreatingList] = useState(false);
  const [listBusy, setListBusy] = useState(false);

  const reloadLists = useCallback(async () => {
    try {
      const next = await clientApiFetch<RecipientListSummary[]>("/recipient-lists");
      setLists(next);
    } catch {
      // Non-fatal: the recipients table is still usable if the list counts
      // fail to refresh — the next full navigation will reconcile them.
    }
  }, []);

  const reload = useCallback(
    async (targetPage: number, listId: string | null) => {
      setPaginating(true);
      try {
        const params = new URLSearchParams({
          page: String(targetPage),
          perPage: String(PER_PAGE),
        });
        if (listId) params.set("listId", listId);
        const result = await clientApiFetch<Paginated<Recipient>>(
          `/recipients?${params.toString()}`,
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
    },
    [],
  );

  function selectList(listId: string | null) {
    setActiveListId(listId);
    setSelected(new Set());
    void reload(1, listId);
  }

  async function handleAddRecipient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formEl = event.currentTarget;
    const formData = new FormData(formEl);
    const firstName = String(formData.get("firstName"));
    const lastName = String(formData.get("lastName"));
    const dateOfBirth = String(formData.get("dateOfBirth") || "");
    const addressPostcode = String(formData.get("addressPostcode") || "");

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
      formEl.reset();
      // New recipients sort first (createdAt desc) — jump to page 1, clearing
      // any list filter so the just-added recipient is actually visible.
      setActiveListId(null);
      await reload(1, null);
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
    const formEl = event.currentTarget;
    const formData = new FormData(formEl);
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
      formEl.reset();
      setActiveListId(null);
      await reload(1, null);
    } catch (importError) {
      setError(importError instanceof ApiError ? importError.message : "Import failed");
    }
  }

  async function handleCreateList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formEl = event.currentTarget;
    const name = String(new FormData(formEl).get("name") || "").trim();
    if (!name) return;
    setCreatingList(true);
    try {
      const created = await clientApiFetch<RecipientListSummary>("/recipient-lists", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setLists((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      formEl.reset();
    } catch (createError) {
      setError(createError instanceof ApiError ? createError.message : "Could not create the list");
    } finally {
      setCreatingList(false);
    }
  }

  async function addSelectedToList() {
    if (!addToListId || selected.size === 0) return;
    setError(null);
    setListBusy(true);
    try {
      await clientApiFetch(`/recipient-lists/${addToListId}/members`, {
        method: "POST",
        body: JSON.stringify({ recipientIds: [...selected] }),
      });
      setSelected(new Set());
      await reloadLists();
    } catch (addError) {
      setError(addError instanceof ApiError ? addError.message : "Could not add to the list");
    } finally {
      setListBusy(false);
    }
  }

  async function renameActiveList() {
    if (!activeListId) return;
    const current = lists.find((l) => l.id === activeListId);
    const name = window.prompt("Rename list", current?.name ?? "")?.trim();
    if (!name || name === current?.name) return;
    setError(null);
    setListBusy(true);
    try {
      await clientApiFetch(`/recipient-lists/${activeListId}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
      await reloadLists();
    } catch (renameError) {
      setError(renameError instanceof ApiError ? renameError.message : "Could not rename the list");
    } finally {
      setListBusy(false);
    }
  }

  async function deleteActiveList() {
    if (!activeListId) return;
    const current = lists.find((l) => l.id === activeListId);
    if (!window.confirm(`Delete "${current?.name ?? "this list"}"? The recipients stay; only the list is removed.`)) {
      return;
    }
    setError(null);
    setListBusy(true);
    try {
      await clientApiFetch(`/recipient-lists/${activeListId}`, { method: "DELETE" });
      setLists((current) => current.filter((l) => l.id !== activeListId));
      selectList(null);
    } catch (deleteError) {
      setError(deleteError instanceof ApiError ? deleteError.message : "Could not delete the list");
    } finally {
      setListBusy(false);
    }
  }

  function toggleSelect(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function toggleArchive(recipient: Recipient) {
    setError(null);
    setRowBusyId(recipient.id);
    try {
      const updated =
        recipient.status === "archived"
          ? await clientApiFetch<Recipient>(`/recipients/${recipient.id}`, {
              method: "PATCH",
              body: JSON.stringify({ status: "active" }),
            })
          : await clientApiFetch<Recipient>(`/recipients/${recipient.id}`, { method: "DELETE" });
      setRecipients((current) => current.map((r) => (r.id === recipient.id ? updated : r)));
    } catch (archiveError) {
      setError(archiveError instanceof ApiError ? archiveError.message : "Could not update the recipient");
    } finally {
      setRowBusyId(null);
    }
  }

  const inputClass = "rounded-md border border-border bg-surface px-3 py-2 text-sm";
  const activeList = activeListId ? lists.find((l) => l.id === activeListId) : null;

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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input name="firstName" placeholder="First name" required className={inputClass} />
            <input name="lastName" placeholder="Last name" required className={inputClass} />
            <input type="date" name="dateOfBirth" className={inputClass} />
            <input name="addressPostcode" placeholder="Postcode" className={inputClass} />
          </div>
          <p className="text-xs text-muted">
            Add a date of birth and their birthday lands on the calendar automatically.
          </p>
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

      {/* CRM awareness: the "there's a faster way than CSV" nudge. */}
      <ConnectCrmCallout />

      {/* Lists: organise recipients into named groups (e.g. "Year 4 class"). */}
      <section className="card flex flex-col gap-3 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Lists</h2>
          <form onSubmit={(event) => void handleCreateList(event)} className="flex items-center gap-2">
            <input name="name" placeholder="New list, e.g. Year 4 class" className={`${inputClass} w-56`} />
            <button type="submit" disabled={creatingList} className="btn-secondary">
              {creatingList ? "Creating…" : "Create"}
            </button>
          </form>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => selectList(null)}
            className={`rounded-full px-3 py-1 text-sm ${
              activeListId === null
                ? "bg-accent text-white"
                : "border border-border hover:bg-foreground/[0.03]"
            }`}
          >
            All recipients
          </button>
          {lists.map((list) => (
            <button
              key={list.id}
              type="button"
              onClick={() => selectList(list.id)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-sm ${
                activeListId === list.id
                  ? "bg-accent text-white"
                  : "border border-border hover:bg-foreground/[0.03]"
              }`}
            >
              <span>{list.name}</span>
              <span className={activeListId === list.id ? "text-white/80" : "text-muted"}>
                {list.memberCount}
              </span>
            </button>
          ))}
          {lists.length === 0 && (
            <span className="text-sm text-muted">No lists yet — create one to group recipients.</span>
          )}
        </div>

        {activeList && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
            <span>
              Showing <span className="font-medium text-foreground">{activeList.name}</span>
            </span>
            <button type="button" onClick={() => void renameActiveList()} disabled={listBusy} className="underline hover:text-foreground">
              Rename
            </button>
            <button type="button" onClick={() => void deleteActiveList()} disabled={listBusy} className="underline hover:text-accent">
              Delete list
            </button>
          </div>
        )}
      </section>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
          <span className="text-muted">{selected.size} selected</span>
          <Link
            href={`/send?recipients=${[...selected].join(",")}`}
            className="btn-accent"
          >
            Send a card →
          </Link>
          {lists.length > 0 && (
            <>
              <span className="text-border">|</span>
              <select
                value={addToListId}
                onChange={(e) => setAddToListId(e.target.value)}
                className={inputClass}
              >
                <option value="">Add to list…</option>
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!addToListId || listBusy}
                onClick={() => void addSelectedToList()}
                className="rounded-full border border-border px-4 py-2 font-medium hover:bg-foreground/[0.03] disabled:opacity-40"
              >
                {listBusy ? "Adding…" : "Add"}
              </button>
            </>
          )}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="w-10 px-5 py-3" />
              <th className="section-label px-5 py-3">Name</th>
              <th className="section-label px-5 py-3">Date of birth</th>
              <th className="section-label px-5 py-3">Postcode</th>
              <th className="section-label px-5 py-3">Source</th>
              <th className="section-label px-5 py-3">Status</th>
              <th className="section-label px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {recipients.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-6 text-muted">
                  {activeList ? "No recipients on this list yet." : "No recipients yet."}
                </td>
              </tr>
            ) : (
              recipients.map((recipient) => {
                const fromIntegration =
                  recipient.source !== "manual" && recipient.source !== "csv";
                return (
                  <tr key={recipient.id} className="border-b border-border last:border-0">
                    <td className="px-5 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(recipient.id)}
                        onChange={() => toggleSelect(recipient.id)}
                        aria-label={`Select ${recipient.firstName} ${recipient.lastName}`}
                      />
                    </td>
                    <td className="px-5 py-3 font-medium">
                      <Link href={`/recipients/${recipient.id}`} className="hover:text-accent hover:underline">
                        {recipient.firstName} {recipient.lastName}
                      </Link>
                      {recipient.addressVerificationRequired && (
                        <span
                          title="A card was returned — address needs updating"
                          className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 align-middle"
                        >
                          ⚠️ Address returned
                        </span>
                      )}
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
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1.5 text-xs">
                        <Link
                          href={`/recipients/${recipient.id}`}
                          className="rounded-md border border-border px-2 py-1 hover:bg-foreground/[0.03]"
                        >
                          Edit
                        </Link>
                        <button
                          type="button"
                          disabled={rowBusyId === recipient.id}
                          onClick={() => void toggleArchive(recipient)}
                          className="rounded-md border border-border px-2 py-1 hover:bg-foreground/[0.03] disabled:opacity-40"
                        >
                          {rowBusyId === recipient.id
                            ? "…"
                            : recipient.status === "archived"
                              ? "Restore"
                              : "Archive"}
                        </button>
                      </div>
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
            onClick={() => void reload(page - 1, activeListId)}
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
            onClick={() => void reload(page + 1, activeListId)}
            className="btn-secondary"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
