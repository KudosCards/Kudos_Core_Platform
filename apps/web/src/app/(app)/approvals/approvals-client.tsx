"use client";

import type { Occasion, SavedDesign } from "@kudos/shared-types";
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
  savedDesigns,
  autoSendEnabled,
}: {
  initialOccasions: OccasionWithRecipient[];
  savedDesigns: SavedDesign[];
  autoSendEnabled: boolean;
}) {
  const [occasions, setOccasions] = useState(initialOccasions);
  const [selectedDesignByOccasion, setSelectedDesignByOccasion] = useState<Record<string, string>>(
    {},
  );
  const [autoSendByOccasion, setAutoSendByOccasion] = useState<Record<string, boolean>>({});
  const [postageByOccasion, setPostageByOccasion] = useState<Record<string, PostageClass>>({});
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function removeFromList(id: string) {
    setOccasions((current) => current.filter((occasion) => occasion.id !== id));
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
    } catch (skipError) {
      setError(skipError instanceof ApiError ? skipError.message : "Could not skip");
    } finally {
      setPendingAction(null);
    }
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

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
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
                      <span>Auto-send — we order, pay from your wallet, and post it automatically</span>
                    </label>
                    {autoSend && (
                      <select
                        value={postageByOccasion[occasion.id] ?? "second_class"}
                        onChange={(e) =>
                          setPostageByOccasion((current) => ({
                            ...current,
                            [occasion.id]: e.target.value as PostageClass,
                          }))
                        }
                        className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
                      >
                        <option value="second_class">Second class (posts ~5 days ahead)</option>
                        <option value="first_class">First class (posts ~3 days ahead)</option>
                      </select>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {savedDesigns.length === 0 && (
        <p className="text-sm text-muted">
          You don&apos;t have any saved designs yet — visit{" "}
          <a href="/designs" className="text-accent hover:underline">
            Designs
          </a>{" "}
          to create one before approving occasions.
        </p>
      )}
    </div>
  );
}
