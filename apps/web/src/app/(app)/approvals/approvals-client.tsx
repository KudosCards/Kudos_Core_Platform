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
      <div>
        <h1 className="text-2xl font-semibold">Approvals</h1>
        <p className="text-foreground/60">
          Review upcoming occasions and choose a design before they&apos;re sent.
          {autoSendEnabled
            ? " Turn on auto-send to have us order, pay from your wallet, and post the card automatically — timed to arrive on time."
            : ""}
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {occasions.length === 0 ? (
        <p className="text-sm text-foreground/60">Nothing waiting for approval right now.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {occasions.map((occasion) => {
            const autoSend = autoSendByOccasion[occasion.id] ?? false;
            return (
              <div
                key={occasion.id}
                className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">
                      {OCCASION_TYPE_LABELS[occasion.type] ?? occasion.type}
                      {occasion.recipient && (
                        <>
                          {" for "}
                          {occasion.recipient.firstName} {occasion.recipient.lastName}
                        </>
                      )}
                    </p>
                    <p className="text-sm text-foreground/60">
                      {formatOccasionDate(occasion.occasionDate)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={selectedDesignByOccasion[occasion.id] ?? ""}
                      onChange={(e) =>
                        setSelectedDesignByOccasion((current) => ({
                          ...current,
                          [occasion.id]: e.target.value,
                        }))
                      }
                      className="rounded-md border border-black/10 px-2 py-1.5 text-sm dark:border-white/10"
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
                      onClick={() => void approve(occasion)}
                      className="rounded-full bg-foreground px-4 py-1.5 text-sm text-background hover:opacity-90 disabled:opacity-50"
                    >
                      {autoSend ? "Approve & auto-send" : "Approve"}
                    </button>
                    <button
                      type="button"
                      disabled={pendingAction === occasion.id}
                      onClick={() => void skip(occasion)}
                      className="rounded-full border border-black/20 px-4 py-1.5 text-sm hover:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/5"
                    >
                      Skip
                    </button>
                  </div>
                </div>

                {autoSendEnabled && (
                  <div className="flex flex-wrap items-center gap-3 border-t border-black/5 pt-3 text-sm dark:border-white/5">
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
                        className="rounded-md border border-black/10 px-2 py-1.5 text-sm dark:border-white/10"
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
        <p className="text-sm text-foreground/60">
          You don&apos;t have any saved designs yet — visit{" "}
          <a href="/designs" className="underline">
            Designs
          </a>{" "}
          to create one before approving occasions.
        </p>
      )}
    </div>
  );
}
