"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RecipientListSummary, SegmentSummary } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { NameDialog } from "@/components/name-dialog";
import {
  RuleBuilder,
  describe,
  fromDefinition,
  toDefinition,
  type RuleState,
} from "../rule-builder";

/**
 * A smart list's own page: who it matches now, and the rule that decides.
 *
 * A saved list can be renamed and its rule changed — neither was possible
 * before, because there was no PATCH and no builder, so the only way to adjust
 * a smart list was to delete it and make a new one under a new name. A
 * suggested preset has no stored row behind it, so it is shown read-only with
 * an offer to save a copy you can then edit. See docs/adr/0177.
 */
export function SmartListClient({
  segment,
  lists,
}: {
  segment: SegmentSummary;
  lists: RecipientListSummary[];
}) {
  const router = useRouter();
  const saved = segment.id !== null;

  const [name, setName] = useState(segment.name);
  const [definition, setDefinition] = useState(segment.definition);
  const [count, setCount] = useState(segment.count);
  const [sample, setSample] = useState(segment.sample);

  const [editing, setEditing] = useState(false);
  const [rule, setRule] = useState<RuleState>(() => fromDefinition(segment.definition));
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function applyUpdated(updated: SegmentSummary) {
    setName(updated.name);
    setDefinition(updated.definition);
    setCount(updated.count);
    setSample(updated.sample);
  }

  async function rename(next: string) {
    if (!segment.id) return;
    setBusy(true);
    setRenameError(null);
    try {
      const updated = await clientApiFetch<SegmentSummary>(`/segments/${segment.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: next }),
      });
      applyUpdated(updated);
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

  async function saveRule() {
    const next = toDefinition(rule);
    if (!segment.id || !next) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await clientApiFetch<SegmentSummary>(`/segments/${segment.id}`, {
        method: "PATCH",
        body: JSON.stringify({ definition: next }),
      });
      applyUpdated(updated);
      setEditing(false);
      router.refresh();
    } catch (saveFailure) {
      setError(saveFailure instanceof ApiError ? saveFailure.message : "Could not save the rule");
    } finally {
      setBusy(false);
    }
  }

  async function saveCopy(copyName: string) {
    setBusy(true);
    setRenameError(null);
    try {
      const created = await clientApiFetch<SegmentSummary>("/segments", {
        method: "POST",
        body: JSON.stringify({ name: copyName, definition }),
      });
      router.push(`/lists/smart/${encodeURIComponent(created.key)}`);
    } catch (copyFailure) {
      setRenameError(
        copyFailure instanceof ApiError ? copyFailure.message : "Could not save the list",
      );
      setBusy(false);
    }
  }

  async function remove() {
    if (!segment.id) return;
    setBusy(true);
    setError(null);
    try {
      await clientApiFetch(`/segments/${segment.id}`, { method: "DELETE" });
      router.push("/lists");
    } catch (removeFailure) {
      setError(
        removeFailure instanceof ApiError ? removeFailure.message : "Could not delete the list",
      );
      setBusy(false);
      setDeleteOpen(false);
    }
  }

  const currentRule = fromDefinition(definition);
  const unpostable = definition.contact?.hasMailableAddress === false;

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/lists" className="text-sm text-muted hover:underline">
          ← Lists
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold tracking-tight">{name}</h1>
            <p className="text-sm text-muted">
              <span className="pill pill-accent">Updates itself</span>{" "}
              <span className="ml-1">
                {count} {count === 1 ? "person matches" : "people match"} right now
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {saved && (
              <button type="button" onClick={() => setRenameOpen(true)} className="btn-secondary">
                Rename
              </button>
            )}
            {count > 0 &&
              (unpostable ? (
                // Everyone on this list is missing an address, so a send would
                // be blocked for every card. Offer the fix instead.
                <Link href="/recipients?missingAddress=true" className="btn-accent">
                  Add their addresses →
                </Link>
              ) : (
                <Link
                  href={`/send?segment=${encodeURIComponent(segment.key)}`}
                  className="btn-accent"
                >
                  Send to this list →
                </Link>
              ))}
          </div>
        </div>
      </div>

      {error && <p className="notice notice-danger">{error}</p>}

      {!saved && (
        <div className="banner banner-info">
          <span className="banner-lead">This is one of our suggestions.</span> You can send to it
          any time without saving. Save a copy to rename it, change the rule, or keep it on your
          Lists page.
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setRenameOpen(true)}
              className="btn-secondary text-sm"
            >
              Save a copy
            </button>
          </div>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">The rule</h2>
          {saved && !editing && (
            <button
              type="button"
              onClick={() => {
                setRule(fromDefinition(definition));
                setEditing(true);
              }}
              className="btn-secondary text-sm"
            >
              Change the rule
            </button>
          )}
        </div>

        {editing ? (
          <>
            <RuleBuilder rule={rule} onChange={setRule} lists={lists} />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void saveRule()}
                disabled={busy || !toDefinition(rule)}
                className="btn-accent disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save the rule"}
              </button>
              <button type="button" onClick={() => setEditing(false)} className="btn-secondary">
                Cancel
              </button>
            </div>
          </>
        ) : (
          <p className="rounded-xl border border-border bg-surface p-4 text-sm">
            {describe(currentRule, lists)}
          </p>
        )}
      </section>

      {!editing && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Who that is right now</h2>
          {sample.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
              Nobody matches this rule at the moment. That can change on its own — the list is
              worked out fresh every time you look.
            </p>
          ) : (
            <ul className="card divide-y divide-border">
              {sample.map((member) => (
                <li
                  key={`${member.recipientId}-${member.detail}`}
                  className="flex justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <Link
                    href={`/recipients/${member.recipientId}`}
                    className="truncate hover:underline"
                  >
                    {member.name}
                  </Link>
                  {member.detail && <span className="shrink-0 text-muted">{member.detail}</span>}
                </li>
              ))}
              {count > sample.length && (
                <li className="px-4 py-2.5 text-xs text-muted">
                  …and {count - sample.length} more
                </li>
              )}
            </ul>
          )}
        </section>
      )}

      {saved && (
        <div className="border-t border-border pt-4">
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            className="text-sm text-muted hover:text-danger hover:underline"
          >
            Delete this list
          </button>
        </div>
      )}

      <NameDialog
        open={renameOpen}
        title={saved ? "Rename list" : "Save a copy"}
        label="List name"
        hint={
          saved ? undefined : "Your copy starts with the same rule, and you can change it after."
        }
        initialValue={name}
        confirmLabel={saved ? "Save name" : "Save list"}
        maxLength={80}
        busy={busy}
        error={renameError}
        onSubmit={(next) => void (saved ? rename(next) : saveCopy(next))}
        onClose={() => {
          setRenameOpen(false);
          setRenameError(null);
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title={`Delete "${name}"?`}
        body="The rule is removed. The contacts it matched are untouched, and you can build the same rule again later."
        confirmLabel="Delete list"
        busy={busy}
        onConfirm={() => void remove()}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
