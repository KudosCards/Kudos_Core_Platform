"use client";

import { Zap } from "lucide-react";
import {
  suggestFirstClass,
  type BulkApproveFailure,
  type BulkApproveResult,
  type Occasion,
  type SavedDesign,
} from "@kudos/shared-types";
import Link from "next/link";
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { formatOccasionDate, occasionKind, occasionName } from "@/lib/occasions";

/**
 * The little square beside each row: the initials of whoever the card is for.
 *
 * It used to be the first three letters of the occasion type, so every row in a
 * queue of birthdays carried an identical "Bir" — a column of the same three
 * letters, telling the reader nothing and helping them find nobody. The person
 * is what distinguishes one row from the next.
 */
function rowInitials(occasion: {
  type: string;
  title?: string | null;
  recipient?: { firstName: string; lastName: string } | null;
}): string {
  const source = occasion.recipient
    ? `${occasion.recipient.firstName} ${occasion.recipient.lastName}`
    : occasionName(occasion);
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0]![0]}${words[1]![0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}
import { TruncationNotice } from "@/components/truncation-notice";

// occasionSchema already includes the nested recipient the real API always
// returns — kept as a named alias since other files import this name.
export type OccasionWithRecipient = Occasion;

type PostageClass = "first_class" | "second_class";

export function ApprovalsClient({
  initialOccasions,
  totalPending,
  initialScheduledSends,
  savedDesigns,
  autoSendEnabled,
}: {
  initialOccasions: OccasionWithRecipient[];
  /** How many are waiting in total, which can exceed what one read returns. */
  totalPending: number;
  initialScheduledSends: OccasionWithRecipient[];
  savedDesigns: SavedDesign[];
  autoSendEnabled: boolean;
}) {
  const [occasions, setOccasions] = useState(initialOccasions);
  // Cards already approved for auto-send but not yet posted (the cron picks them
  // up near their dispatch date). Shown so they're visible after approval, and
  // cancellable until then.
  const [scheduledSends, setScheduledSends] = useState(initialScheduledSends);
  const [selectedDesignByOccasion, setSelectedDesignByOccasion] = useState<Record<string, string>>(
    {},
  );
  const [autoSendByOccasion, setAutoSendByOccasion] = useState<Record<string, boolean>>({});
  const [postageByOccasion, setPostageByOccasion] = useState<Record<string, PostageClass>>({});
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * What this visit has skipped, newest first, so it can be put back.
   *
   * Skipping used to remove the row and that was that — no confirmation, no way
   * back. A school clearing a queue of birthdays that had already passed skipped
   * twenty-seven in about as many seconds, ten of them live birthdays weeks
   * away, and the only repair was a hand-written UPDATE against production.
   */
  const [justSkipped, setJustSkipped] = useState<OccasionWithRecipient[]>([]);
  /** Ticked for a bulk skip. Clearing a backlog should be one deliberate act,
   * not one click per row at the speed a queue invites. */
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  /** The one design a bulk approve applies to everything ticked. */
  const [bulkDesignId, setBulkDesignId] = useState("");
  const [bulkAutoSend, setBulkAutoSend] = useState(false);
  const [bulkPostage, setBulkPostage] = useState<PostageClass>("second_class");
  /** What the last bulk approve could not approve, by name and reason. Kept on
   * screen until the next one: a count with no names is a dead end. */
  const [bulkFailures, setBulkFailures] = useState<BulkApproveFailure[]>([]);

  function removeFromList(id: string) {
    setOccasions((current) => current.filter((occasion) => occasion.id !== id));
    setTicked((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  /**
   * Move a card that has just been approved for auto-send into "Approved and
   * waiting", carrying only what the client actually knows.
   *
   * `savedDesignId` is the design it was approved with, so the row names it
   * rather than falling back to "your chosen design". `dispatchDate` is
   * deliberately null: approving for auto-send re-times it to the postage class
   * server-side, and the pre-approval date the queue was holding is no longer
   * the day the card goes out. The "Posts around" line is guarded on that field,
   * so it stays away rather than naming a day that will not happen.
   *
   * Shared because the row-level Approve did not do this at all, so a single
   * auto-send approval left the queue and appeared nowhere until a reload — the
   * class review finding 23 was about.
   */
  function scheduleApproved(occasion: OccasionWithRecipient, savedDesignId: string) {
    setScheduledSends((current) => [
      {
        ...occasion,
        status: "approved",
        dispatchOption: "auto_send",
        savedDesignId,
        dispatchDate: null,
      } as OccasionWithRecipient,
      ...current,
    ]);
  }

  function toggleTick(id: string) {
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function approve(occasion: OccasionWithRecipient) {
    const savedDesignId = selectedDesignByOccasion[occasion.id];
    if (!savedDesignId) {
      setError("Choose a design before approving");
      return;
    }
    const autoSend = autoSendByOccasion[occasion.id] ?? false;
    setError(null);
    setPendingAction(occasion.id);
    try {
      await clientApiFetch(`/occasions/${occasion.id}/approve`, {
        method: "POST",
        body: JSON.stringify({
          savedDesignId,
          dispatchOption: autoSend ? "auto_send" : "asap",
          ...(autoSend && { postageClass: postageByOccasion[occasion.id] ?? "second_class" }),
        }),
      });
      removeFromList(occasion.id);
      if (autoSend) scheduleApproved(occasion, savedDesignId);
    } catch (approveError) {
      setError(approveError instanceof ApiError ? approveError.message : "Could not approve");
    } finally {
      setPendingAction(null);
    }
  }

  async function skip(occasion: OccasionWithRecipient) {
    setError(null);
    setPendingAction(occasion.id);
    try {
      await clientApiFetch(`/occasions/${occasion.id}/skip`, { method: "POST" });
      removeFromList(occasion.id);
      setJustSkipped((current) => [occasion, ...current]);
    } catch (skipError) {
      setError(skipError instanceof ApiError ? skipError.message : "Could not skip");
    } finally {
      setPendingAction(null);
    }
  }

  /**
   * Approve everything ticked with one design.
   *
   * Approving is where a card's design is chosen, which is why it was one row at
   * a time: "this card, to these thirty pupils, each on their birthday" was
   * thirty separate acts. One request now carries the whole selection, and the
   * server answers per occasion — so a contact whose address is missing for
   * auto-send is named rather than taking the other twenty-nine down with it.
   * See ADR 0219.
   */
  async function approveTicked() {
    const chosen = occasions.filter((o) => ticked.has(o.id));
    if (chosen.length === 0) return;
    if (!bulkDesignId) {
      setError("Choose a design to approve them with");
      return;
    }
    setError(null);
    setBulkFailures([]);
    setBulkBusy(true);
    try {
      const result = await clientApiFetch<BulkApproveResult>("/occasions/approve-bulk", {
        method: "POST",
        body: JSON.stringify({
          occasionIds: chosen.map((o) => o.id),
          savedDesignId: bulkDesignId,
          dispatchOption: bulkAutoSend ? "auto_send" : "asap",
          ...(bulkAutoSend && { postageClass: bulkPostage }),
        }),
      });
      // Only what actually approved leaves the queue. Anything the server could
      // not approve stays on screen, still ticked, beside the reason — the row
      // is where the reader fixes it.
      const approved = new Set(result.approvedIds);
      setOccasions((current) => current.filter((o) => !approved.has(o.id)));
      setTicked((current) => new Set([...current].filter((id) => !approved.has(id))));
      setBulkFailures(result.failed);
      if (bulkAutoSend) {
        for (const occasion of chosen.filter((o) => approved.has(o.id))) {
          scheduleApproved(occasion, bulkDesignId);
        }
      }
    } catch (approveError) {
      setError(approveError instanceof ApiError ? approveError.message : "Could not approve");
    } finally {
      setBulkBusy(false);
    }
  }

  /** Skip everything ticked, in one deliberate action. */
  async function skipTicked() {
    const chosen = occasions.filter((o) => ticked.has(o.id));
    if (chosen.length === 0) return;
    setError(null);
    setBulkBusy(true);
    const done: OccasionWithRecipient[] = [];
    try {
      for (const occasion of chosen) {
        await clientApiFetch(`/occasions/${occasion.id}/skip`, { method: "POST" });
        done.push(occasion);
      }
    } catch (skipError) {
      setError(skipError instanceof ApiError ? skipError.message : "Could not skip");
    } finally {
      // Whatever succeeded before a failure is still skipped, so reflect exactly
      // that — and keep every one of them undoable.
      for (const occasion of done) removeFromList(occasion.id);
      setJustSkipped((current) => [...done.reverse(), ...current]);
      setBulkBusy(false);
    }
  }

  /** Put a skipped occasion back in the queue. */
  async function unskip(occasion: OccasionWithRecipient) {
    setError(null);
    setPendingAction(occasion.id);
    try {
      const restored = await clientApiFetch<OccasionWithRecipient>(
        `/occasions/${occasion.id}/unskip`,
        { method: "POST" },
      );
      setJustSkipped((current) => current.filter((o) => o.id !== occasion.id));
      setOccasions((current) => [restored, ...current]);
    } catch (unskipError) {
      setError(unskipError instanceof ApiError ? unskipError.message : "Could not restore");
    } finally {
      setPendingAction(null);
    }
  }

  /** Cancel a scheduled auto-send: the API returns it to the approvals queue, so
   * move it out of the scheduled list and back to the top of the pending list. */
  async function cancelScheduled(occasion: OccasionWithRecipient) {
    setError(null);
    setPendingAction(occasion.id);
    try {
      const returned = await clientApiFetch<OccasionWithRecipient>(
        `/occasions/${occasion.id}/unapprove`,
        { method: "POST" },
      );
      setScheduledSends((current) => current.filter((o) => o.id !== occasion.id));
      setOccasions((current) => [returned, ...current]);
    } catch (cancelError) {
      setError(cancelError instanceof ApiError ? cancelError.message : "Could not cancel");
    } finally {
      setPendingAction(null);
    }
  }

  /**
   * The failures still worth showing: those whose row is still in the queue.
   *
   * A notice naming somebody the reader has since skipped or approved describes
   * a page that no longer exists. Derived rather than cleared on every action,
   * so there is no list to forget to prune.
   */
  const visibleFailures = bulkFailures.filter((failure) =>
    occasions.some((occasion) => occasion.id === failure.occasionId),
  );

  function designName(savedDesignId: string | null): string {
    return savedDesigns.find((d) => d.id === savedDesignId)?.name ?? "your chosen design";
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Approvals</h1>
        <p className="text-muted">
          Review upcoming occasions and choose a design before they’re sent.
          {autoSendEnabled
            ? " Turn on auto-send to have us order, pay from your wallet, and post the card automatically — timed to arrive on time."
            : ""}
        </p>
      </div>

      {error && <p className="notice notice-danger">{error}</p>}

      {/* A queue that ends without saying so reads as the whole queue. */}
      <TruncationNotice
        shown={initialOccasions.length}
        total={totalPending}
        unit="waiting for approval"
        hint="Approve or skip some to see the rest."
      />

      {/* The way back. Every skip this visit stays here until the page is left,
          because the damage this undoes was done in seconds and noticed days
          later — by which point nothing in the product could reverse it. */}
      {justSkipped.length > 0 && (
        <div className="notice notice-info flex flex-col gap-2">
          <p className="font-medium">
            Skipped {justSkipped.length} {justSkipped.length === 1 ? "card" : "cards"}. Changed your
            mind?
          </p>
          <ul className="flex flex-wrap gap-2">
            {justSkipped.map((occasion) => (
              <li key={occasion.id}>
                <button
                  type="button"
                  disabled={pendingAction === occasion.id}
                  onClick={() => void unskip(occasion)}
                  className="rounded-full border border-black/15 bg-surface px-3 py-1 text-sm hover:bg-black/5 disabled:opacity-40"
                >
                  Restore{" "}
                  <span className="font-medium">
                    {occasion.recipient
                      ? `${occasion.recipient.firstName} ${occasion.recipient.lastName}`
                      : occasionName(occasion)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Clearing a backlog in one action, rather than one click per row at the
          speed a long queue invites — which is how live birthdays got caught up
          in a sweep meant for dead ones. */}
      {ticked.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
          <span>
            <strong>{ticked.size}</strong> selected.
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {/* One design for the whole selection. Approving is where the design
                is chosen, so without this the bulk bar could only ever skip —
                which is why "send this card to these thirty" was thirty acts. */}
            <select
              value={bulkDesignId}
              onChange={(e) => setBulkDesignId(e.target.value)}
              aria-label="Design to approve the selected cards with"
              className="rounded-md border border-border bg-surface px-2 py-2 text-sm"
            >
              <option value="">Choose a design…</option>
              {savedDesigns.map((design) => (
                <option key={design.id} value={design.id}>
                  {design.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setTicked(new Set())}
              className="text-muted hover:text-accent"
            >
              Clear selection
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => void skipTicked()}
              className="btn-secondary"
            >
              {bulkBusy ? "Working…" : `Skip ${ticked.size} selected`}
            </button>
            <button
              type="button"
              disabled={bulkBusy || !bulkDesignId}
              onClick={() => void approveTicked()}
              className="btn-accent"
            >
              {bulkBusy
                ? "Working…"
                : bulkAutoSend
                  ? `Approve & auto-send ${ticked.size}`
                  : `Approve ${ticked.size} selected`}
            </button>
          </div>
          {autoSendEnabled && (
            <div className="flex w-full flex-wrap items-center gap-3 border-t border-accent/20 pt-3">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={bulkAutoSend}
                  onChange={(e) => setBulkAutoSend(e.target.checked)}
                  className="accent-accent"
                />
                <span>Auto-send them — we order, pay from your wallet, and post each one</span>
              </label>
              {bulkAutoSend && (
                <select
                  value={bulkPostage}
                  onChange={(e) => setBulkPostage(e.target.value as PostageClass)}
                  aria-label="Postage class for the selected cards"
                  className="rounded-md border border-border bg-surface px-2 py-1 text-sm"
                >
                  <option value="second_class">Second class</option>
                  <option value="first_class">First class</option>
                </select>
              )}
            </div>
          )}
        </div>
      )}

      {/* Named, not counted. A bulk action that reports "3 failed" leaves the
          reader knowing something is wrong and with no way to act on it — these
          rows are still in the queue above, waiting to be fixed. */}
      {visibleFailures.length > 0 && (
        <div className="notice notice-warning flex flex-col gap-1 text-sm">
          <p className="font-medium">
            {visibleFailures.length} could not be approved — the rest went through.
          </p>
          <ul className="list-inside list-disc">
            {visibleFailures.map((failure) => (
              <li key={failure.occasionId}>
                <strong>{failure.recipientName ?? "This card"}</strong> — {failure.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {occasions.length > 1 && (
        <label className="flex w-fit items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={ticked.size === occasions.length}
            onChange={(e) =>
              setTicked(e.target.checked ? new Set(occasions.map((o) => o.id)) : new Set())
            }
            className="accent-accent"
          />
          Select all {occasions.length}
        </label>
      )}

      {occasions.length === 0 ? (
        <div className="card p-8 text-center text-sm text-muted">
          Nothing waiting for approval right now.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {occasions.map((occasion) => {
            const autoSend = autoSendByOccasion[occasion.id] ?? false;
            return (
              <div key={occasion.id} className="card flex flex-col gap-3 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={ticked.has(occasion.id)}
                      onChange={() => toggleTick(occasion.id)}
                      aria-label={`Select ${
                        occasion.recipient
                          ? `${occasion.recipient.firstName} ${occasion.recipient.lastName}`
                          : occasionName(occasion)
                      }`}
                      className="accent-accent"
                    />
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-accent-soft text-xs font-semibold text-accent">
                      {rowInitials(occasion)}
                    </div>
                    <div>
                      <p className="font-semibold">
                        {occasion.recipient
                          ? `${occasion.recipient.firstName} ${occasion.recipient.lastName}`
                          : occasionName(occasion)}
                      </p>
                      <p className="text-sm text-muted">
                        {/* The name the customer gave this date, then its kind.
                            This line printed the kind alone, so a leaver's date
                            named "96" arrived here as a bare "Leaver". */}
                        {occasionName(occasion)}
                        {occasionKind(occasion) ? ` · ${occasionKind(occasion)}` : ""} ·{" "}
                        {formatOccasionDate(occasion.occasionDate)}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={selectedDesignByOccasion[occasion.id] ?? ""}
                      onChange={(e) =>
                        setSelectedDesignByOccasion((current) => ({
                          ...current,
                          [occasion.id]: e.target.value,
                        }))
                      }
                      className="rounded-md border border-border bg-surface px-2 py-2 text-sm"
                    >
                      <option value="">Choose a design…</option>
                      {savedDesigns.map((design) => (
                        <option key={design.id} value={design.id}>
                          {design.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={pendingAction === occasion.id}
                      onClick={() => void skip(occasion)}
                      className="btn-secondary"
                    >
                      Skip
                    </button>
                    <button
                      type="button"
                      disabled={pendingAction === occasion.id}
                      onClick={() => void approve(occasion)}
                      className="btn-accent"
                    >
                      {autoSend ? "Approve & auto-send" : "Approve"}
                    </button>
                  </div>
                </div>

                {autoSendEnabled && (
                  <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={autoSend}
                        onChange={(e) =>
                          setAutoSendByOccasion((current) => ({
                            ...current,
                            [occasion.id]: e.target.checked,
                          }))
                        }
                        className="accent-accent"
                      />
                      <span>
                        Auto-send — we order, pay from your wallet, and post it automatically
                      </span>
                    </label>
                    {autoSend &&
                      (() => {
                        const postage = postageByOccasion[occasion.id] ?? "second_class";
                        const nudge = suggestFirstClass(new Date(occasion.occasionDate));
                        const showNudge = nudge.suggested && postage !== "first_class";
                        return (
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              value={postage}
                              onChange={(e) =>
                                setPostageByOccasion((current) => ({
                                  ...current,
                                  [occasion.id]: e.target.value as PostageClass,
                                }))
                              }
                              className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
                            >
                              <option value="second_class">
                                Second class (posts ~5 working days ahead)
                              </option>
                              <option value="first_class">
                                First class (posts ~3 working days ahead)
                              </option>
                            </select>
                            {showNudge && (
                              <button
                                type="button"
                                onClick={() =>
                                  setPostageByOccasion((current) => ({
                                    ...current,
                                    [occasion.id]: "first_class",
                                  }))
                                }
                                title={nudge.reason}
                                className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-1 text-xs font-medium text-warning hover:bg-warning/15"
                              >
                                <Zap className="h-3.5 w-3.5" aria-hidden /> {nudge.reason} Use First
                                Class
                              </button>
                            )}
                          </div>
                        );
                      })()}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {scheduledSends.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight">Scheduled to auto-send</h2>
            <p className="text-sm text-muted">
              Approved and waiting — we’ll order, pay from your wallet, and post each one
              automatically near its date. Cancel any time before then to bring it back for review.
            </p>
          </div>
          {scheduledSends.map((occasion) => (
            <div
              key={occasion.id}
              className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-success-soft text-xs font-semibold text-success">
                  {rowInitials(occasion)}
                </div>
                <div>
                  <p className="font-semibold">
                    {occasion.recipient
                      ? `${occasion.recipient.firstName} ${occasion.recipient.lastName}`
                      : occasionName(occasion)}
                  </p>
                  <p className="text-sm text-muted">
                    {occasionName(occasion)}
                    {occasionKind(occasion) ? ` · ${occasionKind(occasion)}` : ""} ·{" "}
                    {formatOccasionDate(occasion.occasionDate)} ·{" "}
                    {designName(occasion.savedDesignId)}
                  </p>
                  {occasion.dispatchDate && (
                    <p className="text-xs text-muted">
                      Posts around {formatOccasionDate(occasion.dispatchDate)}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-medium text-success">
                  Auto-send on
                </span>
                <button
                  type="button"
                  disabled={pendingAction === occasion.id}
                  onClick={() => void cancelScheduled(occasion)}
                  className="btn-secondary"
                >
                  {pendingAction === occasion.id ? "Cancelling…" : "Cancel"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {savedDesigns.length === 0 && (
        <p className="text-sm text-muted">
          You don’t have any saved designs yet — visit{" "}
          <Link href="/designs" className="text-accent hover:underline">
            Designs
          </Link>{" "}
          to create one before approving occasions.
        </p>
      )}
    </div>
  );
}
