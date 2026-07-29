"use client";

import type { Recipient, RecipientListSummary } from "@kudos/shared-types";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { ConnectCrmCallout } from "@/components/connect-crm-callout";
import { AddressFields } from "@/components/address-fields";

/** A contact is mailable only with line 1, city, and postcode — mirrors the
 * API's MISSING_ADDRESS_WHERE so the badge agrees with the server filter/count. */
export function isMailable(recipient: Recipient): boolean {
  return Boolean(
    recipient.addressLine1?.trim() &&
      recipient.addressCity?.trim() &&
      recipient.addressPostcode?.trim(),
  );
}

// First-load page size for the recipients table. Kept modest so the initial
// SSR payload + DOM stays light above the fold; the prev/next controls (and the
// list filter) page through the rest, so nothing is hidden. See ADR 0042.
export const PER_PAGE = 30;

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

type SortKey = "recent" | "name_asc" | "name_desc" | "dob_asc" | "dob_desc";

/** A clickable column header that cycles asc → desc for its column, showing the
 * active direction with an arrow. Clicking a different column starts at asc. */
function SortHeader({
  label,
  ascKey,
  descKey,
  sort,
  onSort,
}: {
  label: string;
  ascKey: SortKey;
  descKey: SortKey;
  sort: SortKey;
  onSort: (key: SortKey) => void;
}) {
  const active = sort === ascKey || sort === descKey;
  const arrow = sort === ascKey ? "↑" : sort === descKey ? "↓" : "";
  return (
    <button
      type="button"
      onClick={() => onSort(sort === ascKey ? descKey : ascKey)}
      className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}
    >
      {label}
      <span aria-hidden className="text-xs">
        {arrow}
      </span>
    </button>
  );
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
  initialMissingOnly = false,
}: {
  initialRecipients: Recipient[];
  initialTotal: number;
  initialPage: number;
  initialLists: RecipientListSummary[];
  /** When true (from ?missingAddress=true), the contacts-without-address filter
   * starts on — the target of the dashboard "needs address" nudge. */
  initialMissingOnly?: boolean;
}) {
  const [recipients, setRecipients] = useState(initialRecipients);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(initialPage);
  // Server-side search (API `search`) + column sort. Search is debounced so we
  // don't fire a request per keystroke.
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [error, setError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [paginating, setPaginating] = useState(false);
  const [addingRecipient, setAddingRecipient] = useState(false);
  // Bumped on a successful add to remount AddressFields (controlled inputs that
  // formEl.reset() can't clear).
  const [addFormKey, setAddFormKey] = useState(0);
  // "Needs address" worklist filter. Kept in a ref too so the shared reload()
  // can read it without every call site having to thread it through.
  const [missingOnly, setMissingOnly] = useState(initialMissingOnly);
  const missingOnlyRef = useRef(initialMissingOnly);
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
    async (targetPage: number, listId: string | null, searchTerm: string, sortKey: SortKey) => {
      setPaginating(true);
      try {
        const params = new URLSearchParams({
          page: String(targetPage),
          perPage: String(PER_PAGE),
        });
        if (listId) params.set("listId", listId);
        if (searchTerm) params.set("search", searchTerm);
        if (sortKey !== "recent") params.set("sort", sortKey);
        if (missingOnlyRef.current) params.set("missingAddress", "true");
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

  // Debounce the search box; a settled term (or a cleared one) reloads page 1.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Re-fetch whenever the settled search term or the sort changes. Skips the
  // first render (the server already sent page 1 with default search/sort).
  const firstQueryRun = useRef(true);
  useEffect(() => {
    if (firstQueryRun.current) {
      firstQueryRun.current = false;
      return;
    }
    void reload(1, activeListId, debouncedSearch, sort);
    // activeListId is intentionally omitted — selectList drives its own reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, sort, reload]);

  function changeSearch(value: string) {
    setSearch(value);
    setSelected(new Set());
  }

  function changeSort(key: SortKey) {
    setSort(key);
    setSelected(new Set());
  }

  function selectList(listId: string | null) {
    setActiveListId(listId);
    setSelected(new Set());
    void reload(1, listId, debouncedSearch, sort);
  }

  async function handleAddRecipient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formEl = event.currentTarget;
    const formData = new FormData(formEl);
    const firstName = String(formData.get("firstName"));
    const lastName = String(formData.get("lastName"));
    const dateOfBirth = String(formData.get("dateOfBirth") || "");
    const addressLine1 = String(formData.get("addressLine1") || "").trim();
    const addressLine2 = String(formData.get("addressLine2") || "").trim();
    const addressCity = String(formData.get("addressCity") || "").trim();
    const addressPostcode = String(formData.get("addressPostcode") || "").trim();

    setAddingRecipient(true);
    try {
      await clientApiFetch("/recipients", {
        method: "POST",
        body: JSON.stringify({
          firstName,
          lastName,
          ...(dateOfBirth && { dateOfBirth }),
          // The form requires these, so they're present; guard anyway so we never
          // send an empty string (which the API's @Length would reject).
          ...(addressLine1 && { addressLine1 }),
          ...(addressLine2 && { addressLine2 }),
          ...(addressCity && { addressCity }),
          ...(addressPostcode && { addressPostcode }),
        }),
      });
      formEl.reset();
      setAddFormKey((k) => k + 1);
      // New recipients sort first (createdAt desc) — jump to page 1, clearing
      // the list filter, search, and sort so the just-added recipient is visible.
      setActiveListId(null);
      setSearch("");
      setDebouncedSearch("");
      setSort("recent");
      await reload(1, null, "", "recent");
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
      setSearch("");
      setDebouncedSearch("");
      setSort("recent");
      await reload(1, null, "", "recent");
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

  // Select-all toggles every recipient on the current page. When some but not
  // all are selected, the first click selects the rest.
  const allOnPageSelected =
    recipients.length > 0 && recipients.every((r) => selected.has(r.id));
  function toggleSelectAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allOnPageSelected) {
        recipients.forEach((r) => next.delete(r.id));
      } else {
        recipients.forEach((r) => next.add(r.id));
      }
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
            <input type="date" name="dateOfBirth" aria-label="Date of birth" className={inputClass} />
          </div>
          <AddressFields key={addFormKey} />
          <p className="text-xs text-muted">
            We post real cards, so a full address is required. Add a date of birth and their birthday
            lands on the calendar automatically.
          </p>
          <button type="submit" disabled={addingRecipient} className="btn-accent self-start">
            {addingRecipient ? "Adding…" : "Add recipient"}
          </button>
        </form>

        <form onSubmit={(event) => void handleImport(event)} className="card flex flex-col gap-3 p-6">
          <h2 className="font-semibold">Import from CSV</h2>
          <p className="text-xs text-muted">
            Columns: firstName, lastName, dateOfBirth (dd/mm/yyyy), addressLine1, addressLine2,
            addressCity, postcode, email. Contacts without a full address still import — they&apos;re
            flagged &ldquo;needs address&rdquo; so you can complete them before sending.
          </p>
          <input
            type="file"
            name="file"
            accept=".csv"
            required
            className="block w-full cursor-pointer rounded-md border border-border bg-surface text-sm text-muted file:mr-3 file:cursor-pointer file:border-0 file:bg-accent file:px-4 file:py-2 file:font-medium file:text-white hover:file:bg-accent-hover"
          />
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

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <input
            value={search}
            onChange={(e) => changeSearch(e.target.value)}
            placeholder="Search by name…"
            className={`${inputClass} w-full pr-8`}
            aria-label="Search recipients by name"
          />
          {search && (
            <button
              type="button"
              onClick={() => changeSearch("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
            >
              ✕
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            const next = !missingOnly;
            setMissingOnly(next);
            missingOnlyRef.current = next;
            void reload(1, activeListId, debouncedSearch, sort);
          }}
          aria-pressed={missingOnly}
          className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
            missingOnly
              ? "border-amber-400 bg-amber-100 font-medium text-amber-800"
              : "border-border text-muted hover:bg-foreground/[0.03]"
          }`}
        >
          ⚠️ Needs address
        </button>
        {debouncedSearch && (
          <span className="text-sm text-muted">
            {total} match{total === 1 ? "" : "es"} for “{debouncedSearch}”
          </span>
        )}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="w-10 px-5 py-3">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleSelectAll}
                  aria-label="Select all on this page"
                />
              </th>
              <th className="section-label px-5 py-3">
                <SortHeader label="Name" ascKey="name_asc" descKey="name_desc" sort={sort} onSort={changeSort} />
              </th>
              <th className="section-label px-5 py-3">
                <SortHeader label="Date of birth" ascKey="dob_asc" descKey="dob_desc" sort={sort} onSort={changeSort} />
              </th>
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
                    <td className="px-5 py-3 text-muted">
                      {isMailable(recipient) ? (
                        recipient.addressPostcode
                      ) : (
                        <Link
                          href={`/recipients/${recipient.id}`}
                          title="No mailable address — add one before sending a card"
                          className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-200"
                        >
                          ⚠️ Needs address
                        </Link>
                      )}
                    </td>
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
            onClick={() => void reload(page - 1, activeListId, debouncedSearch, sort)}
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
            onClick={() => void reload(page + 1, activeListId, debouncedSearch, sort)}
            className="btn-secondary"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
