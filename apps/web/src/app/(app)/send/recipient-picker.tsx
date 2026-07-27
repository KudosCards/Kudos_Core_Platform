"use client";

import type { Recipient, RecipientListSummary } from "@kudos/shared-types";
import { ukPostcodeRegex } from "@kudos/shared-types";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

const PER_PAGE = 20;

function isMailable(recipient: Recipient): boolean {
  return (
    !!recipient.addressLine1?.trim() &&
    !!recipient.addressCity?.trim() &&
    !!recipient.addressPostcode &&
    ukPostcodeRegex.test(recipient.addressPostcode)
  );
}

/**
 * A searchable, list-filterable, paginated multi-select over the account's
 * contacts — the "who to send to" half of the bulk-send composer. It owns its
 * own fetching (search / list / page) but not the selection: the parent holds
 * `selectedIds` and reacts to `onToggle`, so a selected contact stays selected
 * even when it scrolls off the current page or search.
 */
export function RecipientPicker({
  initialPage,
  lists,
  selectedIds,
  onToggle,
}: {
  initialPage: Paginated<Recipient>;
  lists: RecipientListSummary[];
  selectedIds: Set<string>;
  onToggle: (recipient: Recipient) => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [listId, setListId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paginated<Recipient>>(initialPage);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const didMount = useRef(false);

  // Debounce the search box so we don't fire a request per keystroke; a new
  // search resets to the first page. (The list filter resets the page in its
  // click handler.) Both run in the timeout callback — not synchronously in the
  // effect body — so they don't cascade renders.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Fetch on any change — skipping the first render, which is already seeded
  // with the server's first page (no loading flash on mount).
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      perPage: String(PER_PAGE),
      status: "active",
    });
    if (debounced) params.set("search", debounced);
    if (listId) params.set("listId", listId);
    clientApiFetch<Paginated<Recipient>>(`/recipients?${params.toString()}`)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      })
      .catch((fetchError) => {
        if (!cancelled) {
          setError(fetchError instanceof ApiError ? fetchError.message : "Could not load contacts");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, listId, page]);

  const totalPages = Math.max(1, Math.ceil(data.total / PER_PAGE));
  const unselectedShown = data.items.filter((recipient) => !selectedIds.has(recipient.id));

  const chipClass = (active: boolean) =>
    `rounded-full px-3 py-1 text-sm ${
      active ? "bg-accent text-white" : "border border-border hover:bg-foreground/[0.03]"
    }`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search contacts by name…"
          className="flex-1 rounded-md border border-border bg-surface px-3 py-2.5 text-base sm:text-sm"
        />
        {unselectedShown.length > 0 && (
          <button
            type="button"
            onClick={() => unselectedShown.forEach(onToggle)}
            className="shrink-0 rounded-md border border-border px-3 py-2 text-sm hover:bg-foreground/[0.03]"
          >
            Select all shown
          </button>
        )}
      </div>

      {lists.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setListId(null);
              setPage(1);
            }}
            className={chipClass(listId === null)}
          >
            All
          </button>
          {lists.map((list) => (
            <button
              key={list.id}
              type="button"
              onClick={() => {
                setListId(list.id);
                setPage(1);
              }}
              className={chipClass(listId === list.id)}
            >
              {list.name}
              <span className={listId === list.id ? "ml-1 text-white/80" : "ml-1 text-muted"}>
                {list.memberCount}
              </span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm font-medium text-accent">
          {error}
        </p>
      )}

      <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {data.items.length === 0 ? (
          <li className="px-4 py-6 text-center text-sm text-muted">
            {loading ? "Loading…" : "No contacts found."}
          </li>
        ) : (
          data.items.map((recipient) => {
            const checked = selectedIds.has(recipient.id);
            const mailable = isMailable(recipient);
            return (
              <li key={recipient.id}>
                <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-foreground/[0.02]">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(recipient)}
                    className="size-4 shrink-0 accent-accent"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {recipient.firstName} {recipient.lastName}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {mailable
                        ? [recipient.addressLine1, recipient.addressCity, recipient.addressPostcode]
                            .filter(Boolean)
                            .join(", ")
                        : "No postal address yet"}
                    </span>
                  </span>
                  {!mailable && (
                    <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                      No address
                    </span>
                  )}
                </label>
              </li>
            );
          })
        )}
      </ul>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="btn-secondary disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-muted">
            Page {data.page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((current) => current + 1)}
            className="btn-secondary disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
