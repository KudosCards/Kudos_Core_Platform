"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import type { OccasionWithRecipient } from "../approvals/approvals-client";

interface LineDraft {
  shippingAddressLine1: string;
  shippingAddressLine2: string;
  shippingAddressCity: string;
  shippingAddressPostcode: string;
  dispatchOption: "asap" | "auto_send";
  postageClass: "first_class" | "second_class";
}

const EMPTY_LINE: LineDraft = {
  shippingAddressLine1: "",
  shippingAddressLine2: "",
  shippingAddressCity: "",
  shippingAddressPostcode: "",
  dispatchOption: "asap",
  postageClass: "first_class",
};

const OCCASION_TYPE_LABELS: Record<string, string> = {
  birthday: "Birthday",
  achievement: "Achievement",
  leaver: "Leaver",
  staff_recognition: "Staff recognition",
  seasonal: "Seasonal",
  bespoke_campaign: "Bespoke campaign",
};

function formatOccasionDate(value: string | Date): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const inputClass = "rounded-md border border-black/10 px-3 py-2 text-sm dark:border-white/10";

export function BatchOrdersClient({
  initialOccasions,
}: {
  initialOccasions: OccasionWithRecipient[];
}) {
  const [lines, setLines] = useState<Record<string, LineDraft>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedIds = Object.keys(lines);

  function toggle(occasionId: string) {
    setLines((current) => {
      if (occasionId in current) {
        const next = { ...current };
        delete next[occasionId];
        return next;
      }
      return { ...current, [occasionId]: { ...EMPTY_LINE } };
    });
  }

  function updateLine(occasionId: string, patch: Partial<LineDraft>) {
    setLines((current) => ({ ...current, [occasionId]: { ...current[occasionId]!, ...patch } }));
  }

  async function handleCheckout() {
    setError(null);
    if (selectedIds.length === 0) {
      setError("Select at least one occasion to include");
      return;
    }
    for (const occasionId of selectedIds) {
      const line = lines[occasionId]!;
      if (
        !line.shippingAddressLine1 ||
        !line.shippingAddressCity ||
        !line.shippingAddressPostcode
      ) {
        setError("Fill in the shipping address for every selected card");
        return;
      }
    }

    setSubmitting(true);
    try {
      const order = await clientApiFetch<{ id: string }>("/batch-orders", {
        method: "POST",
        body: JSON.stringify({
          lines: selectedIds.map((occasionId) => ({ occasionId, ...lines[occasionId]! })),
        }),
      });
      const { checkoutUrl } = await clientApiFetch<{ checkoutUrl: string }>(
        `/batch-orders/${order.id}/checkout`,
        { method: "POST" },
      );
      window.location.assign(checkoutUrl);
    } catch (checkoutError) {
      setError(
        checkoutError instanceof ApiError ? checkoutError.message : "Could not start checkout",
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Checkout</h1>
        <p className="text-foreground/60">
          Choose which approved occasions to print and post, add a shipping address for each, then
          pay to send them to production.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {initialOccasions.length === 0 ? (
        <p className="text-sm text-foreground/60">
          Nothing is approved and ready yet — visit{" "}
          <a href="/approvals" className="underline">
            Approvals
          </a>{" "}
          to approve some occasions first.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {initialOccasions.map((occasion) => {
            const selected = lines[occasion.id];
            return (
              <div
                key={occasion.id}
                className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
              >
                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={selected !== undefined}
                    onChange={() => toggle(occasion.id)}
                  />
                  <span className="font-medium">
                    {OCCASION_TYPE_LABELS[occasion.type] ?? occasion.type}
                    {occasion.recipient && (
                      <>
                        {" for "}
                        {occasion.recipient.firstName} {occasion.recipient.lastName}
                      </>
                    )}
                  </span>
                  <span className="text-sm text-foreground/60">
                    {formatOccasionDate(occasion.occasionDate)}
                  </span>
                </label>

                {selected && (
                  <div className="grid gap-2 pl-7 sm:grid-cols-2">
                    <input
                      placeholder="Address line 1"
                      value={selected.shippingAddressLine1}
                      onChange={(e) =>
                        updateLine(occasion.id, { shippingAddressLine1: e.target.value })
                      }
                      className={inputClass}
                    />
                    <input
                      placeholder="Address line 2 (optional)"
                      value={selected.shippingAddressLine2}
                      onChange={(e) =>
                        updateLine(occasion.id, { shippingAddressLine2: e.target.value })
                      }
                      className={inputClass}
                    />
                    <input
                      placeholder="City"
                      value={selected.shippingAddressCity}
                      onChange={(e) =>
                        updateLine(occasion.id, { shippingAddressCity: e.target.value })
                      }
                      className={inputClass}
                    />
                    <input
                      placeholder="Postcode"
                      value={selected.shippingAddressPostcode}
                      onChange={(e) =>
                        updateLine(occasion.id, { shippingAddressPostcode: e.target.value })
                      }
                      className={inputClass}
                    />
                    <select
                      value={selected.dispatchOption}
                      onChange={(e) =>
                        updateLine(occasion.id, {
                          dispatchOption: e.target.value as LineDraft["dispatchOption"],
                        })
                      }
                      className={inputClass}
                    >
                      <option value="asap">Dispatch as soon as possible</option>
                      <option value="auto_send">Auto-send ahead of the occasion date</option>
                    </select>
                    <select
                      value={selected.postageClass}
                      onChange={(e) =>
                        updateLine(occasion.id, {
                          postageClass: e.target.value as LineDraft["postageClass"],
                        })
                      }
                      className={inputClass}
                    >
                      <option value="first_class">First class post</option>
                      <option value="second_class">Second class post</option>
                    </select>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {initialOccasions.length > 0 && (
        <div>
          <button
            type="button"
            disabled={submitting || selectedIds.length === 0}
            onClick={() => void handleCheckout()}
            className="rounded-full bg-foreground px-5 py-2 text-sm text-background hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Starting checkout…" : `Pay for ${selectedIds.length} card(s)`}
          </button>
        </div>
      )}
    </div>
  );
}
