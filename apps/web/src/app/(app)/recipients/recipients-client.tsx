"use client";

import type { Recipient, RecipientListSummary } from "@kudos/shared-types";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { AddressFields } from "@/components/address-fields";
import { CsvImport, downloadSampleCsv } from "@/components/csv-import";
import { Modal } from "@/components/modal";

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

/** Month labels for the birthday-month filter; index 0 = January. */
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

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
/** The source options offered in the filter — the known integration spine. */
const SOURCE_OPTIONS = ["manual", "csv", "api", "brevo", "hubspot", "gohighlevel"];

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

type SortKey = "recent" | "name_asc" | "name_desc" | "dob_asc" | "dob_desc";

/** The recipient's next upcoming birthday (year-agnostic) + a friendly countdown,
 * or null when no date of birth is set. */
function nextBirthday(dob: string | Date | null): { label: string; countdown: string } | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
  if (next.getTime() < today.getTime()) next.setFullYear(today.getFullYear() + 1);
  const inDays = Math.round((next.getTime() - today.getTime()) / 86_400_000);
  const label = next.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const countdown = inDays === 0 ? "Today" : inDays === 1 ? "Tomorrow" : `In ${inDays} days`;
  return { label, countdown };
}

/** "12 Coniscliffe Road, Darlington" — the one-line address shown under a name. */
function addressLine(r: Recipient): string {
  return [r.addressLine1, r.addressCity].filter((part) => part?.trim()).join(", ");
}

/** "Ann and Bob" / "Ann, Bob and 3 more" — for the missing-address banner. */
function joinNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

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
  const [paginating, setPaginating] = useState(false);
  const [addingRecipient, setAddingRecipient] = useState(false);
  // Bumped on a successful add to remount AddressFields (controlled inputs that
  // formEl.reset() can't clear).
  const [addFormKey, setAddFormKey] = useState(0);
  // Header-action modals: the add form and CSV import moved off the page into
  // dialogs so the contact list is the primary focus (see ADR 0097).
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // "Needs address" worklist filter. Kept in a ref too so the shared reload()
  // can read it without every call site having to thread it through.
  const [missingOnly, setMissingOnly] = useState(initialMissingOnly);
  const missingOnlyRef = useRef(initialMissingOnly);
  const [archivedView, setArchivedView] = useState(false);
  const archivedViewRef = useRef(false);
  const [birthMonth, setBirthMonth] = useState("");
  const birthMonthRef = useRef("");
  const [source, setSource] = useState("");
  const sourceRef = useRef("");
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  // Unfiltered tab counts + the missing-address worklist, refreshed independently
  // of the (filtered) table so the tabs and banner stay accurate.
  const [activeCount, setActiveCount] = useState(initialMissingOnly ? 0 : initialTotal);
  const [archivedCount, setArchivedCount] = useState(0);
  const [missing, setMissing] = useState<Recipient[]>([]);
  const [missingTotal, setMissingTotal] = useState(0);

  // Lists state.
  const [lists, setLists] = useState<RecipientListSummary[]>(initialLists);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [listBusy, setListBusy] = useState(false);

  const reloadLists = useCallback(async () => {
    try {
      setLists(await clientApiFetch<RecipientListSummary[]>("/recipient-lists"));
    } catch {
      // Non-fatal: the table is still usable if the counts fail to refresh.
    }
  }, []);

  /** Refresh the tab counts + the missing-address worklist (all unfiltered). */
  const refreshMeta = useCallback(async () => {
    try {
      const [active, archived, miss] = await Promise.all([
        clientApiFetch<Paginated<Recipient>>("/recipients?perPage=1"),
        clientApiFetch<Paginated<Recipient>>("/recipients?perPage=1&status=archived"),
        clientApiFetch<Paginated<Recipient>>("/recipients?missingAddress=true&perPage=100"),
      ]);
      setActiveCount(active.total);
      setArchivedCount(archived.total);
      setMissing(miss.items);
      setMissingTotal(miss.total);
    } catch {
      // Non-fatal — the tabs/banner just keep their last values.
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
        if (birthMonthRef.current) params.set("birthMonth", birthMonthRef.current);
        if (sourceRef.current) params.set("source", sourceRef.current);
        if (archivedViewRef.current) params.set("status", "archived");
        const result = await clientApiFetch<Paginated<Recipient>>(
          `/recipients?${params.toString()}`,
        );
        setRecipients(result.items);
        setTotal(result.total);
        setPage(targetPage);
        setError(null);
      } catch (reloadError) {
        setError(reloadError instanceof ApiError ? reloadError.message : "Could not load contacts");
      } finally {
        setPaginating(false);
      }
    },
    [],
  );

  useEffect(() => {
    // Mount-only fetch of the tab counts + missing-address worklist. The setState
    // calls land in refreshMeta's async body (after the fetch resolves), not
    // synchronously in this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshMeta();
  }, [refreshMeta]);

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

  function changeBirthMonth(value: string) {
    setBirthMonth(value);
    birthMonthRef.current = value;
    setSelected(new Set());
    void reload(1, activeListId, debouncedSearch, sort);
  }

  function changeSource(value: string) {
    setSource(value);
    sourceRef.current = value;
    setSelected(new Set());
    void reload(1, activeListId, debouncedSearch, sort);
  }

  function switchArchivedView(next: boolean) {
    if (next === archivedView) return;
    setArchivedView(next);
    archivedViewRef.current = next;
    setSelected(new Set());
    void reload(1, activeListId, debouncedSearch, sort);
  }

  function setMissingFilter(next: boolean) {
    setMissingOnly(next);
    missingOnlyRef.current = next;
    setSelected(new Set());
    void reload(1, activeListId, debouncedSearch, sort);
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
          ...(addressLine1 && { addressLine1 }),
          ...(addressLine2 && { addressLine2 }),
          ...(addressCity && { addressCity }),
          ...(addressPostcode && { addressPostcode }),
        }),
      });
      formEl.reset();
      setAddFormKey((k) => k + 1);
      setAddOpen(false);
      // New recipients sort first (createdAt desc) — jump to page 1, clearing
      // filters/search so the just-added recipient is visible.
      setActiveListId(null);
      setSearch("");
      setDebouncedSearch("");
      setSort("recent");
      setArchivedView(false);
      archivedViewRef.current = false;
      setMissingOnly(false);
      missingOnlyRef.current = false;
      setBirthMonth("");
      birthMonthRef.current = "";
      setSource("");
      sourceRef.current = "";
      await reload(1, null, "", "recent");
      void refreshMeta();
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : "Could not add contact");
    } finally {
      setAddingRecipient(false);
    }
  }

  // After a CSV import completes, surface the just-added contacts: jump to the
  // main (non-archived) list, clear filters/search, and refresh table + counts.
  function handleImported() {
    setImportOpen(false);
    setActiveListId(null);
    setSearch("");
    setDebouncedSearch("");
    setSort("recent");
    setArchivedView(false);
    archivedViewRef.current = false;
    setMissingOnly(false);
    missingOnlyRef.current = false;
    void reload(1, null, "", "recent");
    void reloadLists();
    void refreshMeta();
  }

  /** Create a list and return it (used by both list-filter and add-to-list). */
  async function createList(name: string): Promise<RecipientListSummary | null> {
    try {
      const created = await clientApiFetch<RecipientListSummary>("/recipient-lists", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setLists((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      return created;
    } catch (createError) {
      setError(createError instanceof ApiError ? createError.message : "Could not create the list");
      return null;
    }
  }

  /** The list-filter dropdown, with a "＋ New list…" escape hatch. */
  async function handleListFilterChange(value: string) {
    if (value === "__new__") {
      const name = window.prompt("New list name")?.trim();
      if (!name) return;
      const created = await createList(name);
      if (created) selectList(created.id);
      return;
    }
    selectList(value || null);
  }

  async function addSelectedToList(listId: string) {
    if (!listId || selected.size === 0) return;
    setError(null);
    setListBusy(true);
    try {
      await clientApiFetch(`/recipient-lists/${listId}/members`, {
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

  async function handleAddToList(value: string) {
    if (!value) return;
    if (value === "__new__") {
      const name = window.prompt("New list name")?.trim();
      if (!name) return;
      const created = await createList(name);
      if (created) await addSelectedToList(created.id);
      return;
    }
    await addSelectedToList(value);
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
    if (
      !window.confirm(
        `Delete "${current?.name ?? "this list"}"? The contacts stay; only the list is removed.`,
      )
    ) {
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

  const allOnPageSelected = recipients.length > 0 && recipients.every((r) => selected.has(r.id));
  function toggleSelectAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allOnPageSelected) recipients.forEach((r) => next.delete(r.id));
      else recipients.forEach((r) => next.add(r.id));
      return next;
    });
  }

  /** Drop a row from the current view once its status no longer matches the
   * folder (archived out of Active, restored out of Archived). */
  function dropFromView(id: string) {
    setRecipients((current) => current.filter((r) => r.id !== id));
    setSelected((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setTotal((current) => Math.max(0, current - 1));
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
      const stillInView = archivedViewRef.current
        ? updated.status === "archived"
        : updated.status !== "archived";
      if (stillInView) {
        setRecipients((current) => current.map((r) => (r.id === recipient.id ? updated : r)));
      } else {
        dropFromView(recipient.id);
      }
      void refreshMeta();
    } catch (archiveError) {
      setError(
        archiveError instanceof ApiError ? archiveError.message : "Could not update the contact",
      );
    } finally {
      setRowBusyId(null);
    }
  }

  /** Bulk archive (Active view) or restore (Archived view) the selection. */
  async function bulkArchiveOrRestore() {
    const ids = recipients.filter((r) => selected.has(r.id)).map((r) => r.id);
    if (ids.length === 0) return;
    setError(null);
    setListBusy(true);
    try {
      for (const id of ids) {
        if (archivedViewRef.current) {
          await clientApiFetch(`/recipients/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ status: "active" }),
          });
        } else {
          await clientApiFetch(`/recipients/${id}`, { method: "DELETE" });
        }
        dropFromView(id);
      }
      setSelected(new Set());
      void refreshMeta();
    } catch (bulkError) {
      setError(bulkError instanceof ApiError ? bulkError.message : "Could not update the contacts");
    } finally {
      setListBusy(false);
    }
  }

  /** Export the selected recipients (current page) to a CSV file. */
  function exportSelected() {
    const rows = recipients.filter((r) => selected.has(r.id));
    if (rows.length === 0) return;
    const header = [
      "First name",
      "Last name",
      "Date of birth",
      "Address line 1",
      "Address line 2",
      "City",
      "Postcode",
      "Source",
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = rows.map((r) =>
      [
        r.firstName,
        r.lastName,
        r.dateOfBirth ? new Date(r.dateOfBirth).toLocaleDateString("en-GB") : "",
        r.addressLine1 ?? "",
        r.addressLine2 ?? "",
        r.addressCity ?? "",
        r.addressPostcode ?? "",
        sourceLabel(r.source),
      ]
        .map(esc)
        .join(","),
    );
    const csv = [header.map(esc).join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const inputClass = "rounded-md border border-border bg-surface px-3 py-2 text-sm";
  const activeList = activeListId ? lists.find((l) => l.id === activeListId) : null;
  const emptyMessage = archivedView
    ? "No archived contacts."
    : missingOnly
      ? "Every contact has a mailable address. 🎉"
      : activeList
        ? "No contacts on this list yet."
        : search || birthMonth || source
          ? "No contacts match your filters."
          : "No contacts yet — add one or import a CSV to get started.";
  // The true people count for the header (unfiltered), not the filtered table total.
  const peopleCount = archivedView ? archivedCount : activeCount;
  const showMissingBanner = !missingOnly && !archivedView && missingTotal > 0;
  const footerLabel =
    total === 0
      ? null
      : total <= recipients.length
        ? `Showing all ${total} ${archivedView ? "archived" : "active"} contact${total === 1 ? "" : "s"}`
        : `Showing ${recipients.length} of ${total}`;

  return (
    <div className="flex flex-col gap-5">
      {/* Header: title + intent on the left, the primary actions on the right —
          the add form + CSV import live in dialogs so the list stays the focus. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight">Contacts</h1>
          <p className="max-w-md text-sm text-muted">
            {peopleCount} {peopleCount === 1 ? "person" : "people"}. We post real cards, so every
            contact needs a full postal address.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/integrations" className="text-sm font-semibold text-accent hover:underline">
            Sync a CRM
          </Link>
          <button type="button" onClick={() => setImportOpen(true)} className="btn-secondary">
            Import CSV
          </button>
          <button type="button" onClick={() => setAddOpen(true)} className="btn-accent">
            Add contact
          </button>
        </div>
      </div>

      {error && <p className="notice notice-danger">{error}</p>}

      {/* Missing-address banner — the worklist nudge, front and centre. */}
      {showMissingBanner && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
          <p className="text-accent">
            <span className="font-semibold">
              {missingTotal} contact{missingTotal === 1 ? "" : "s"} can&apos;t be posted to.
            </span>{" "}
            {joinNames(missing.slice(0, 3).map((r) => `${r.firstName} ${r.lastName}`))}{" "}
            {missingTotal === 1 ? "is" : "are"} missing an address.
          </p>
          <button
            type="button"
            onClick={() => setMissingFilter(true)}
            className="btn-secondary shrink-0"
          >
            Show these {missingTotal}
          </button>
        </div>
      )}

      {/* Filters: folder toggle, search, list, birthday month, source. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-border p-0.5 text-sm">
          <button
            type="button"
            onClick={() => switchArchivedView(false)}
            aria-pressed={!archivedView}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              !archivedView ? "bg-foreground text-background" : "text-muted hover:text-foreground"
            }`}
          >
            Active <span className="tabular-nums opacity-70">{activeCount}</span>
          </button>
          <button
            type="button"
            onClick={() => switchArchivedView(true)}
            aria-pressed={archivedView}
            className={`rounded-md px-3 py-1.5 transition-colors ${
              archivedView ? "bg-foreground text-background" : "text-muted hover:text-foreground"
            }`}
          >
            Archived <span className="tabular-nums opacity-70">{archivedCount}</span>
          </button>
        </div>

        <div className="relative min-w-[12rem] flex-1">
          <input
            value={search}
            onChange={(e) => changeSearch(e.target.value)}
            placeholder="Search by name, postcode or town…"
            className={`${inputClass} w-full pr-8`}
            aria-label="Search contacts"
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

        <select
          value={activeListId ?? ""}
          onChange={(e) => void handleListFilterChange(e.target.value)}
          aria-label="Filter by list"
          className={inputClass}
        >
          <option value="">All contacts</option>
          {lists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.name} ({list.memberCount})
            </option>
          ))}
          <option value="__new__">＋ New list…</option>
        </select>

        <select
          value={birthMonth}
          onChange={(e) => changeBirthMonth(e.target.value)}
          aria-label="Filter by birthday month"
          className={`${inputClass} ${birthMonth ? "border-accent font-medium text-accent" : ""}`}
        >
          <option value="">All birthdays</option>
          {MONTH_NAMES.map((name, index) => (
            <option key={name} value={String(index + 1)}>
              {name}
            </option>
          ))}
        </select>

        <select
          value={source}
          onChange={(e) => changeSource(e.target.value)}
          aria-label="Filter by source"
          className={`${inputClass} ${source ? "border-accent font-medium text-accent" : ""}`}
        >
          <option value="">Any source</option>
          {SOURCE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {sourceLabel(s)}
            </option>
          ))}
        </select>
      </div>

      {/* Active-list management + the "needs address" filter's clear affordance. */}
      {(activeList || missingOnly) && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
          {activeList && (
            <>
              <span>
                Showing <span className="font-medium text-foreground">{activeList.name}</span>
              </span>
              <button
                type="button"
                onClick={() => void renameActiveList()}
                disabled={listBusy}
                className="underline hover:text-foreground"
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => void deleteActiveList()}
                disabled={listBusy}
                className="underline hover:text-accent"
              >
                Delete list
              </button>
            </>
          )}
          {missingOnly && (
            <button
              type="button"
              onClick={() => setMissingFilter(false)}
              className="underline hover:text-foreground"
            >
              Showing only contacts that need an address — show all
            </button>
          )}
        </div>
      )}

      {/* Bulk-action bar (dark), shown when rows are selected. */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-foreground px-4 py-2.5 text-sm text-background">
          <div className="flex items-center gap-3">
            <span className="font-medium">{selected.size} selected</span>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-background/70 hover:text-background"
            >
              Clear
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value=""
              onChange={(e) => void handleAddToList(e.target.value)}
              disabled={listBusy}
              aria-label="Add selected to a list"
              className="rounded-md border border-background/25 bg-transparent px-2 py-1 text-background hover:bg-background/10"
            >
              <option value="">Add to list</option>
              {lists.map((list) => (
                <option key={list.id} value={list.id} className="text-foreground">
                  {list.name}
                </option>
              ))}
              <option value="__new__" className="text-foreground">
                ＋ New list…
              </option>
            </select>
            <button
              type="button"
              onClick={exportSelected}
              className="rounded-md border border-background/25 px-3 py-1 hover:bg-background/10"
            >
              Export
            </button>
            <button
              type="button"
              disabled={listBusy}
              onClick={() => void bulkArchiveOrRestore()}
              className="rounded-md border border-background/25 px-3 py-1 hover:bg-background/10 disabled:opacity-50"
            >
              {archivedView ? "Restore" : "Archive"}
            </button>
            <Link
              href={`/send?recipients=${[...selected].join(",")}`}
              className="rounded-md bg-accent px-3 py-1 font-semibold text-white hover:bg-accent-hover"
            >
              Send a card to {selected.size} →
            </Link>
          </div>
        </div>
      )}

      {/* Table on ≥sm; a stacked-card list replaces it on phones (below). */}
      <div className="card hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[880px] text-left text-sm">
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
                <SortHeader
                  label="Name & address"
                  ascKey="name_asc"
                  descKey="name_desc"
                  sort={sort}
                  onSort={changeSort}
                />
              </th>
              <th className="section-label px-5 py-3">
                <SortHeader
                  label="Date of birth"
                  ascKey="dob_asc"
                  descKey="dob_desc"
                  sort={sort}
                  onSort={changeSort}
                />
              </th>
              <th className="section-label px-5 py-3">Next birthday</th>
              <th className="section-label px-5 py-3">Postcode</th>
              <th className="section-label px-5 py-3">Source</th>
              <th className="section-label px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {recipients.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-muted">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              recipients.map((recipient) => {
                const fromIntegration = recipient.source !== "manual" && recipient.source !== "csv";
                const mailable = isMailable(recipient);
                const birthday = nextBirthday(recipient.dateOfBirth);
                return (
                  <tr
                    key={recipient.id}
                    className="border-b border-border last:border-0 hover:bg-foreground/[0.02]"
                  >
                    <td className="px-5 py-3 align-top">
                      <input
                        type="checkbox"
                        checked={selected.has(recipient.id)}
                        onChange={() => toggleSelect(recipient.id)}
                        aria-label={`Select ${recipient.firstName} ${recipient.lastName}`}
                      />
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex flex-col">
                        <span className="font-medium">
                          <Link
                            href={`/recipients/${recipient.id}`}
                            className="hover:text-accent hover:underline"
                          >
                            {recipient.firstName} {recipient.lastName}
                          </Link>
                          {recipient.addressVerificationRequired && (
                            <span
                              title="A card was returned — address needs updating"
                              className="ml-2 inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning align-middle"
                            >
                              ⚠️ Address returned
                            </span>
                          )}
                        </span>
                        {mailable ? (
                          <span className="text-xs text-muted">{addressLine(recipient)}</span>
                        ) : (
                          <Link
                            href={`/recipients/${recipient.id}`}
                            className="text-xs font-medium text-accent hover:underline"
                          >
                            Needs an address before we can post
                          </Link>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted">
                      {recipient.dateOfBirth
                        ? new Date(recipient.dateOfBirth).toLocaleDateString("en-GB")
                        : "—"}
                    </td>
                    <td className="px-5 py-3">
                      {birthday ? (
                        <div className="flex flex-col">
                          <span className="font-medium">{birthday.label}</span>
                          <span className="text-xs text-muted uppercase">{birthday.countdown}</span>
                        </div>
                      ) : (
                        <div className="flex flex-col">
                          <span className="text-muted">Not set</span>
                          <Link
                            href={`/recipients/${recipient.id}`}
                            className="text-xs text-accent uppercase hover:underline"
                          >
                            Add a date
                          </Link>
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3 text-muted">
                      {mailable ? recipient.addressPostcode : "—"}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`pill ${fromIntegration ? "pill-accent" : "pill-muted"}`}>
                        {sourceLabel(recipient.source)}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-3 text-sm">
                        <Link
                          href={`/recipients/${recipient.id}`}
                          className="text-accent hover:underline"
                        >
                          Edit
                        </Link>
                        <button
                          type="button"
                          disabled={rowBusyId === recipient.id}
                          onClick={() => void toggleArchive(recipient)}
                          className="text-muted hover:text-foreground disabled:opacity-40"
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

      {/* Mobile stacked-card list (below sm). Same data as the table above. */}
      <div className="flex flex-col gap-3 sm:hidden">
        {recipients.length === 0 ? (
          <p className="card px-4 py-6 text-sm text-muted">{emptyMessage}</p>
        ) : (
          <>
            <button
              type="button"
              onClick={toggleSelectAll}
              className="inline-flex min-h-11 items-center self-start text-sm font-medium text-accent"
            >
              {allOnPageSelected ? "Clear selection" : "Select all on this page"}
            </button>
            {recipients.map((recipient) => {
              const fromIntegration = recipient.source !== "manual" && recipient.source !== "csv";
              const mailable = isMailable(recipient);
              const birthday = nextBirthday(recipient.dateOfBirth);
              return (
                <div key={recipient.id} className="card flex flex-col gap-3 p-4">
                  <div className="flex items-start gap-3">
                    <label className="flex min-h-11 min-w-11 items-center justify-center">
                      <input
                        type="checkbox"
                        checked={selected.has(recipient.id)}
                        onChange={() => toggleSelect(recipient.id)}
                        aria-label={`Select ${recipient.firstName} ${recipient.lastName}`}
                      />
                    </label>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/recipients/${recipient.id}`}
                        className="font-medium hover:text-accent hover:underline"
                      >
                        {recipient.firstName} {recipient.lastName}
                      </Link>
                      {recipient.addressVerificationRequired && (
                        <span
                          title="A card was returned — address needs updating"
                          className="ml-2 inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning align-middle"
                        >
                          ⚠️ Address returned
                        </span>
                      )}
                      {mailable ? (
                        <p className="text-xs text-muted">{addressLine(recipient)}</p>
                      ) : (
                        <Link
                          href={`/recipients/${recipient.id}`}
                          className="text-xs font-medium text-accent hover:underline"
                        >
                          Needs an address before we can post
                        </Link>
                      )}
                      <div className="mt-1">
                        <span className={`pill ${fromIntegration ? "pill-accent" : "pill-muted"}`}>
                          {sourceLabel(recipient.source)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    <div className="flex flex-col">
                      <dt className="section-label">Date of birth</dt>
                      <dd className="text-muted">
                        {recipient.dateOfBirth
                          ? new Date(recipient.dateOfBirth).toLocaleDateString("en-GB")
                          : "—"}
                      </dd>
                    </div>
                    <div className="flex flex-col">
                      <dt className="section-label">Next birthday</dt>
                      <dd className="text-muted">
                        {birthday ? `${birthday.label} · ${birthday.countdown}` : "Not set"}
                      </dd>
                    </div>
                  </dl>

                  <div className="flex items-center gap-2 border-t border-border pt-3 text-sm">
                    <Link
                      href={`/recipients/${recipient.id}`}
                      className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md border border-border px-3 hover:bg-foreground/[0.03]"
                    >
                      Edit
                    </Link>
                    <button
                      type="button"
                      disabled={rowBusyId === recipient.id}
                      onClick={() => void toggleArchive(recipient)}
                      className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md border border-border px-3 hover:bg-foreground/[0.03] disabled:opacity-40"
                    >
                      {rowBusyId === recipient.id
                        ? "…"
                        : recipient.status === "archived"
                          ? "Restore"
                          : "Archive"}
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Footer: count on the left, low-emphasis entry points on the right. */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-muted">{footerLabel}</span>
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" onClick={downloadSampleCsv} className="text-accent hover:underline">
            Download a sample CSV
          </button>
          <Link href="/integrations" className="text-accent hover:underline">
            Connect Brevo, HubSpot or Zapier
          </Link>
        </div>
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

      {/* Add-recipient dialog. */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add a contact">
        <form onSubmit={(event) => void handleAddRecipient(event)} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input name="firstName" placeholder="First name" required className={inputClass} />
            <input name="lastName" placeholder="Last name" required className={inputClass} />
            <input
              type="date"
              name="dateOfBirth"
              aria-label="Date of birth"
              className={`${inputClass} sm:col-span-2`}
            />
          </div>
          <AddressFields key={addFormKey} required={false} />
          <p className="text-xs text-muted">
            The address is optional — save the contact now and add it later. We&apos;ll flag anyone
            without one and won&apos;t let a card be sent until it&apos;s added. A date of birth
            puts their birthday on the calendar automatically.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAddOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" disabled={addingRecipient} className="btn-accent">
              {addingRecipient ? "Adding…" : "Add contact"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Import-CSV dialog. */}
      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import from CSV">
        <CsvImport onImported={handleImported} />
      </Modal>
    </div>
  );
}
