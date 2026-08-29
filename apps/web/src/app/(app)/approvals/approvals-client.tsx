"use client";

import { Zap } from "lucide-react";
import { suggestFirstClass, type Occasion, type SavedDesign } from "@kudos/shared-types";
import Link from "next/link";
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { OCCASION_TYPE_LABELS, formatOccasionDate } from "@/lib/occasions";

// occasionSchema already includes the nested recipient the real API always
// returns — kept as a named alias since other files import this name.
export type OccasionWithRecipient = Occasion;

type PostageClass = "first_class" | "second_class";

export function ApprovalsClient({
  initialOccasions,
  initialScheduledSends,
  savedDesigns,
  autoSendEnabled,
}: {
  initialOccasions: OccasionWithRecipient[];
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

  function removeFromList(id: string) {
    setOccasions((current) => current.filter((occasion) => occasion.id !== id));
    setTicked((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
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

  function designName(savedDesignId: string | null): string {
    return savedDesigns.find((d) => d.id === savedDesignId)?.name ?? "your chosen design";
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Approvals</h1>
        <p className="text-muted">
          Review upcoming occasions and choose a design before they&apos;re sent.
          {autoSendEnabled
            ? " Turn on auto-send to have us order, pay from your wallet, and post the card automatically — timed to arrive on time."
            : ""}
        </p>
      </div>

      {error && <p className="notice notice-danger">{error}</p>}

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
                      : (OCCASION_TYPE_LABELS[occasion.type] ?? occasion.type)}
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
          <div className="flex items-center gap-2">
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
              {bulkBusy ? "Skipping…" : `Skip ${ticked.size} selected`}
            </button>
          </div>
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
                          : (OCCASION_TYPE_LABELS[occasion.type] ?? occasion.type)
                      }`}
                      className="accent-accent"
                    />
                    <div className="flex size-12 shrink-0 items-center justify-center rounded-md bg-accent-soft text-xs font-semibold text-accent">
                      {(OCCASION_TYPE_LABELS[occasion.type] ?? occasion.type).slice(0, 3)}
                    </div>
                    <div>
                      <p className="font-semibold">
                        {occasion.recipient
                          ? `${occasion.recipient.firstName} ${occasion.recipient.lastName}`
                          : (OCCASION_TYPE_LABELS[occasion.type] ?? occasion.type)}
                      </p>
                      <p className="text-sm text-muted">
                        {OCCASION_TYPE_LABELS[occasion.type] ?? occasion.type} ·{" "}
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
              Approved and waiting — we&apos;ll order, pay from your wallet, and post each one
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
                  {(OCCASION_TYPE_LABELS[occasion.type] ?? occasion.type).slice(0, 3)}
                </div>
                <div>
                  <p className="font-semibold">
                    {occasion.recipient
                      ? `${occasion.recipient.firstName} ${occasion.recipient.lastName}`
                      : (OCCASION_TYPE_LABELS[occasion.type] ?? occasion.type)}
                  </p>
                  <p className="text-sm text-muted">
                    {OCCASION_TYPE_LABELS[occasion.type] ?? occasion.type} ·{" "}
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
          You don&apos;t have any saved designs yet — visit{" "}
          <Link href="/designs" className="text-accent hover:underline">
            Designs
          </Link>{" "}
          to create one before approving occasions.
        </p>
      )}
    </div>
  );
}
