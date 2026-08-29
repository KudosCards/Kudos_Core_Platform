"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { RecipientListSummary, SegmentSummary, SegmentsOverview } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { NameDialog } from "@/components/name-dialog";
import { ListCard, type ListCardModel } from "./list-card";

type Filter = "all" | "picked" | "smart";

function pickedModel(list: RecipientListSummary): ListCardModel {
  return {
    key: `picked-${list.id}`,
    name: list.name,
    description: null,
    kind: "picked",
    count: list.memberCount,
    sample: list.sample.map((m) => ({ id: m.id, name: `${m.firstName} ${m.lastName}` })),
    href: `/lists/${list.id}`,
    sendHref: `/send?list=${encodeURIComponent(list.id)}`,
  };
}

function smartModel(segment: SegmentSummary): ListCardModel {
  return {
    key: `smart-${segment.key}`,
    name: segment.name,
    description: segment.description,
    kind: "smart",
    count: segment.count,
    sample: segment.sample.map((m) => ({
      id: m.recipientId,
      name: m.name,
      detail: m.detail || undefined,
    })),
    href: `/lists/smart/${encodeURIComponent(segment.key)}`,
    sendHref: `/send?segment=${encodeURIComponent(segment.key)}`,
    unpostable: segment.definition.contact?.hasMailableAddress === false,
  };
}

/**
 * The Lists page: every grouping of contacts, of either kind, in one grid.
 *
 * Before this there were two half-features. Smart lists had a page, a card, a
 * live count and a one-click send. Hand-picked lists — the ones a customer
 * actually builds, person by person — had no page at all: they existed only as
 * options in a filter dropdown on Contacts, were created through a browser
 * prompt hidden inside that dropdown, could only be renamed while you happened
 * to be filtered to them, and could not be sent to without ticking every member
 * by hand. The thing you made yourself was the harder one to use.
 *
 * See docs/adr/0177.
 */
export function ListsClient({
  initialPicked,
  initialSmart,
}: {
  initialPicked: RecipientListSummary[];
  initialSmart: SegmentsOverview;
}) {
  const [picked, setPicked] = useState(initialPicked);
  const [saved, setSaved] = useState(initialSmart.saved);
  const suggested = initialSmart.suggested;

  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<ListCardModel | null>(null);

  const cards = useMemo(() => {
    const all = [...picked.map(pickedModel), ...saved.map(smartModel)];
    all.sort((a, b) => a.name.localeCompare(b.name));
    return filter === "all" ? all : all.filter((c) => c.kind === filter);
  }, [picked, saved, filter]);

  async function createPicked(name: string) {
    setBusy(true);
    setCreateError(null);
    try {
      const created = await clientApiFetch<RecipientListSummary>("/recipient-lists", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setPicked((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      setCreateOpen(false);
    } catch (createFailure) {
      setCreateError(
        createFailure instanceof ApiError ? createFailure.message : "Could not create the list",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveSuggested(segment: SegmentSummary) {
    setError(null);
    setBusy(true);
    try {
      const created = await clientApiFetch<SegmentSummary>("/segments", {
        method: "POST",
        body: JSON.stringify({ name: segment.name, definition: segment.definition }),
      });
      setSaved((current) => [created, ...current]);
    } catch (saveFailure) {
      setError(saveFailure instanceof ApiError ? saveFailure.message : "Could not save the list");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    setError(null);
    setBusy(true);
    try {
      if (target.kind === "picked") {
        const id = target.key.slice("picked-".length);
        await clientApiFetch(`/recipient-lists/${id}`, { method: "DELETE" });
        setPicked((current) => current.filter((l) => l.id !== id));
      } else {
        const id = target.key.slice("smart-".length);
        await clientApiFetch(`/segments/${id}`, { method: "DELETE" });
        setSaved((current) => current.filter((s) => s.id !== id));
      }
      setDeleting(null);
    } catch (deleteFailure) {
      setError(
        deleteFailure instanceof ApiError ? deleteFailure.message : "Could not delete the list",
      );
    } finally {
      setBusy(false);
    }
  }

  // A suggested list is only worth offering if it isn't already saved under the
  // same rule — otherwise the page shows the same group twice and "Save" does
  // nothing visible, which is exactly what the old page did.
  const savedRules = new Set(saved.map((s) => JSON.stringify(s.definition)));
  const offerable = suggested.filter((s) => !savedRules.has(JSON.stringify(s.definition)));

  const total = picked.length + saved.length;
  const filterCounts: Record<Filter, number> = {
    all: total,
    picked: picked.length,
    smart: saved.length,
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight">Lists</h1>
          <p className="max-w-lg text-sm text-muted">
            Groups of contacts you can send to in one go. Pick the people yourself, or set a rule
            and let the list keep itself up to date.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/lists/smart/new" className="btn-secondary">
            New smart list
          </Link>
          <button type="button" onClick={() => setCreateOpen(true)} className="btn-accent">
            New list
          </button>
        </div>
      </div>

      {error && <p className="notice notice-danger">{error}</p>}

      {total > 0 && (
        <div className="flex flex-wrap gap-2">
          {(["all", "picked", "smart"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={
                filter === key
                  ? "rounded-full bg-accent px-3.5 py-1.5 text-sm font-semibold text-white"
                  : "rounded-full border border-border px-3.5 py-1.5 text-sm hover:bg-foreground/[0.03]"
              }
            >
              {key === "all" ? "All" : key === "picked" ? "Picked by hand" : "Updates itself"}
              <span className={filter === key ? "ml-1.5 text-white/80" : "ml-1.5 text-muted"}>
                {filterCounts[key]}
              </span>
            </button>
          ))}
        </div>
      )}

      {total === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <p className="font-semibold">No lists yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            A list is a group you send to in one go — a class, a team, everyone with a birthday
            coming up. Start one by hand, or save a suggestion below.
          </p>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="btn-accent mt-4 inline-block"
          >
            New list
          </button>
        </div>
      ) : cards.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
          {filter === "picked"
            ? "No hand-picked lists yet."
            : "No smart lists saved yet — save a suggestion below."}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <ListCard
              key={card.key}
              list={card}
              // No "Open" button: the card's title already links there, and a
              // third control pushed Delete onto its own line at card width.
              actions={
                <button
                  type="button"
                  onClick={() => setDeleting(card)}
                  className="ml-auto rounded-md px-2 py-1.5 text-sm text-muted hover:bg-foreground/[0.03] hover:text-danger"
                >
                  Delete
                </button>
              }
            />
          ))}
        </div>
      )}

      {offerable.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-lg font-semibold">Suggested smart lists</h2>
            <p className="text-sm text-muted">
              Ready-made rules. Save one to keep it on this page, or send to it right now without
              saving anything.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {offerable.map((segment) => (
              <ListCard
                key={segment.key}
                list={smartModel(segment)}
                actions={
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveSuggested(segment)}
                    className="btn-secondary text-sm disabled:opacity-50"
                  >
                    Save to my lists
                  </button>
                }
              />
            ))}
          </div>
        </section>
      )}

      <NameDialog
        open={createOpen}
        title="New list"
        label="List name"
        hint="You'll add people to it next — from Contacts, or from the list itself."
        confirmLabel="Create list"
        busy={busy}
        error={createError}
        onSubmit={(name) => void createPicked(name)}
        onClose={() => {
          setCreateOpen(false);
          setCreateError(null);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete "${deleting?.name ?? ""}"?`}
        body={
          deleting?.kind === "smart"
            ? "The rule is removed. The contacts it matched are untouched, and you can save the same rule again later."
            : "The list is removed. Every contact on it stays in your contacts — only the grouping goes."
        }
        confirmLabel="Delete list"
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
