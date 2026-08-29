"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Recipient, RecipientListSummary } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { NameDialog } from "@/components/name-dialog";
import { isMailable, type Paginated } from "../../recipients/recipients-client";

export const MEMBERS_PER_PAGE = 25;

/**
 * A hand-picked list's own page — the thing that did not exist.
 *
 * A list could be created and added to, and after that it was a name in a
 * dropdown. There was no way to see who was on it, no way to take one person
 * off (the API route existed and nothing called it), no way to rename it unless
 * you happened to be filtered to it, and no way to send to it without ticking
 * every member by hand, twenty to a page.
 *
 * Members come from `GET /recipients?listId=`, the same endpoint the contacts
 * table uses, so this page pages and searches the same way rather than being a
 * second, weaker view of the same people. See docs/adr/0177.
 */
export function PickedListClient({
  list,
  initialMembers,
}: {
  list: RecipientListSummary;
  initialMembers: Paginated<Recipient>;
}) {
  const router = useRouter();

  const [name, setName] = useState(list.name);
  const [members, setMembers] = useState(initialMembers.items);
  const [total, setTotal] = useState(initialMembers.total);
  const [page, setPage] = useState(initialMembers.page);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const reload = useCallback(
    async (nextPage: number, term: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          listId: list.id,
          page: String(nextPage),
          perPage: String(MEMBERS_PER_PAGE),
        });
        if (term) params.set("search", term);
        const result = await clientApiFetch<Paginated<Recipient>>(`/recipients?${params}`);
        setMembers(result.items);
        setTotal(result.total);
        setPage(result.page);
      } catch (loadError) {
        setError(loadError instanceof ApiError ? loadError.message : "Could not load this list");
      } finally {
        setLoading(false);
      }
    },
    [list.id],
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Skip the first run: the server already rendered page 1 with no search term.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    void reload(1, debounced);
  }, [debounced, reload]);

  async function rename(next: string) {
    setBusy(true);
    setRenameError(null);
    try {
      await clientApiFetch(`/recipient-lists/${list.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: next }),
      });
      setName(next);
      setRenameOpen(false);
      router.refresh();
    } catch (renameFailure) {
      setRenameError(
        renameFailure instanceof ApiError ? renameFailure.message : "Could not rename the list",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await clientApiFetch<RecipientListSummary>(
        `/recipient-lists/${list.id}/members`,
        { method: "DELETE", body: JSON.stringify({ recipientIds: [...selected] }) },
      );
      setSelected(new Set());
      setTotal(updated.memberCount);
      // Re-read the current page: removing members can empty it, and the page
      // before it is where the remaining people now are.
      const lastPage = Math.max(1, Math.ceil(updated.memberCount / MEMBERS_PER_PAGE));
      await reload(Math.min(page, lastPage), debounced);
    } catch (removeFailure) {
      setError(
        removeFailure instanceof ApiError
          ? removeFailure.message
          : "Could not take those contacts off the list",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteList() {
    setBusy(true);
    setError(null);
    try {
      await clientApiFetch(`/recipient-lists/${list.id}`, { method: "DELETE" });
      router.push("/lists");
    } catch (deleteFailure) {
      setError(
        deleteFailure instanceof ApiError ? deleteFailure.message : "Could not delete the list",
      );
      setBusy(false);
      setDeleteOpen(false);
    }
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allOnPageSelected = members.length > 0 && members.every((m) => selected.has(m.id));
  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allOnPageSelected) members.forEach((m) => next.delete(m.id));
      else members.forEach((m) => next.add(m.id));
      return next;
    });
  }

  const lastPage = Math.max(1, Math.ceil(total / MEMBERS_PER_PAGE));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/lists" className="text-sm text-muted hover:underline">
          ← Lists
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold tracking-tight">{name}</h1>
            <p className="text-sm text-muted">
              <span className="pill pill-muted">Picked by hand</span>{" "}
              <span className="ml-1">
                {total} {total === 1 ? "person" : "people"} on this list
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setRenameOpen(true)} className="btn-secondary">
              Rename
            </button>
            <Link
              href={`/recipients?addToList=${encodeURIComponent(list.id)}`}
              className="btn-secondary"
            >
              Add contacts
            </Link>
            {total > 0 && (
              <Link href={`/send?list=${encodeURIComponent(list.id)}`} className="btn-accent">
                Send to this list →
              </Link>
            )}
          </div>
        </div>
      </div>

      {error && <p className="notice notice-danger">{error}</p>}

      {total === 0 && !debounced ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <p className="font-semibold">Nobody on this list yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            Add people from your contacts — tick them there and choose this list, or use Add
            contacts above.
          </p>
          <Link
            href={`/recipients?addToList=${encodeURIComponent(list.id)}`}
            className="btn-accent mt-4 inline-block"
          >
            Add contacts
          </Link>
        </div>
      ) : (
        <>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search this list"
            aria-label="Search this list"
            className="w-full max-w-xs rounded-md border border-border bg-surface px-3 py-2 text-sm"
          />

          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-foreground px-4 py-3 text-sm text-background">
              <span className="font-semibold">{selected.size} selected</span>
              <button
                type="button"
                onClick={() => void removeSelected()}
                disabled={busy}
                className="rounded-md border border-background/30 px-3 py-1.5 font-medium hover:bg-background/10 disabled:opacity-50"
              >
                Take off this list
              </button>
              <Link
                href={`/send?recipients=${[...selected].join(",")}`}
                className="rounded-md border border-background/30 px-3 py-1.5 font-medium hover:bg-background/10"
              >
                Send a card to {selected.size} →
              </Link>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="ml-auto text-background/70 hover:text-background"
              >
                Clear
              </button>
            </div>
          )}

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-muted uppercase">
                <tr>
                  <th className="w-10 px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={toggleAll}
                      aria-label="Select everyone on this page"
                      className="size-4 accent-accent"
                    />
                  </th>
                  <th className="px-2 py-2.5 font-medium">Name & address</th>
                  <th className="px-2 py-2.5 font-medium">Postcode</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-muted">
                      {loading ? "Loading…" : "Nobody on this list matches that search."}
                    </td>
                  </tr>
                ) : (
                  members.map((member) => (
                    <tr key={member.id} className="hover:bg-foreground/[0.02]">
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected.has(member.id)}
                          onChange={() => toggle(member.id)}
                          aria-label={`Select ${member.firstName} ${member.lastName}`}
                          className="size-4 accent-accent"
                        />
                      </td>
                      <td className="px-2 py-2.5">
                        <Link
                          href={`/recipients/${member.id}`}
                          className="font-medium hover:underline"
                        >
                          {member.firstName} {member.lastName}
                        </Link>
                        <span className="block text-xs text-muted">
                          {isMailable(member)
                            ? [member.addressLine1, member.addressCity].filter(Boolean).join(", ")
                            : "Needs an address"}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-muted">{member.addressPostcode ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {lastPage > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">
                Page {page} of {lastPage}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1 || loading}
                  onClick={() => void reload(page - 1, debounced)}
                  className="btn-secondary disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={page >= lastPage || loading}
                  onClick={() => void reload(page + 1, debounced)}
                  className="btn-secondary disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <div className="border-t border-border pt-4">
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="text-sm text-muted hover:text-danger hover:underline"
        >
          Delete this list
        </button>
      </div>

      <NameDialog
        open={renameOpen}
        title="Rename list"
        label="List name"
        initialValue={name}
        confirmLabel="Save name"
        busy={busy}
        error={renameError}
        onSubmit={(next) => void rename(next)}
        onClose={() => {
          setRenameOpen(false);
          setRenameError(null);
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title={`Delete "${name}"?`}
        body="The list is removed. Every contact on it stays in your contacts — only the grouping goes."
        confirmLabel="Delete list"
        busy={busy}
        onConfirm={() => void deleteList()}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
