"use client";

import type { Recipient, ReturnCase } from "@kudos/shared-types";
import { useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

const REASON_LABELS: Record<string, string> = {
  moved: "The recipient has moved",
  incomplete_address: "The address was incomplete",
  incorrect_address: "The address was incorrect",
  undeliverable: "Delivery wasn't possible",
  other: "Returned by Royal Mail",
};

const inputClass = "rounded-md border border-border bg-surface px-3 py-2 text-sm";

/**
 * The Returned-to-Sender recovery workflow shown on a contact record: an alert
 * for each open return case, the Update-Address step, then the one free Kudos
 * Promise recovery (resend / hand-deliver) or archive. See ADR 0039.
 */
export function ReturnRecoveryPanel({
  recipient,
  initialCases,
  onRecipientChanged,
}: {
  recipient: Recipient;
  initialCases: ReturnCase[];
  onRecipientChanged: (recipient: Partial<Recipient>) => void;
}) {
  const [cases, setCases] = useState<ReturnCase[]>(initialCases);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [businessFor, setBusinessFor] = useState<string | null>(null);

  const open = cases.filter((c) => c.status === "awaiting_address" || c.status === "awaiting_resend");
  if (open.length === 0) return null;

  function applyUpdated(updated: ReturnCase) {
    setCases((list) => list.map((c) => (c.id === updated.id ? updated : c)));
    // When a case resolves and no other stays open, the contact's flag clears.
    const stillOpen = cases.some(
      (c) => c.id !== updated.id && (c.status === "awaiting_address" || c.status === "awaiting_resend"),
    );
    const nowOpen = updated.status === "awaiting_address" || updated.status === "awaiting_resend";
    if (!nowOpen && !stillOpen) {
      onRecipientChanged({ addressVerificationRequired: false });
    }
  }

  async function act(caseId: string, path: string, body?: unknown): Promise<ReturnCase | null> {
    setError(null);
    setPendingId(caseId);
    try {
      const updated = await clientApiFetch<ReturnCase>(`/returns/${caseId}/${path}`, {
        method: "POST",
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      applyUpdated(updated);
      return updated;
    } catch (actError) {
      setError(actError instanceof ApiError ? actError.message : "Something went wrong");
      return null;
    } finally {
      setPendingId(null);
    }
  }

  async function submitAddress(event: FormEvent<HTMLFormElement>, caseId: string, path: string) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const str = (k: string) => String(data.get(k) || "").trim();
    const body = {
      addressLine1: str("addressLine1"),
      ...(str("addressLine2") && { addressLine2: str("addressLine2") }),
      addressCity: str("addressCity"),
      addressPostcode: str("addressPostcode"),
    };
    const updated = await act(caseId, path, body);
    if (updated && path === "address") {
      // The corrected address is now on the contact — reflect it in the header.
      onRecipientChanged({
        addressLine1: body.addressLine1,
        addressLine2: body.addressLine2 ?? null,
        addressCity: body.addressCity,
        addressPostcode: body.addressPostcode,
      });
      setBusinessFor(null);
    }
    if (updated && path === "send-to-business") setBusinessFor(null);
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-5">
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-lg">
          ⚠️
        </span>
        <h2 className="text-lg font-semibold text-amber-900">Address needs attention</h2>
      </div>
      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
      )}

      {open.map((c) => {
        const busy = pendingId === c.id;
        return (
          <div key={c.id} className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-surface p-4">
            <p className="text-sm text-foreground">
              A card to <strong>{c.recipientName}</strong> (order ORD-{c.orderNumber}) was returned to us.{" "}
              <span className="text-muted">{REASON_LABELS[c.reason] ?? "Returned by Royal Mail"}.</span>
            </p>
            <p className="text-xs text-muted">
              Kudos Promise: once the address is corrected, we&apos;ll resend this card{" "}
              <strong>free of charge</strong>, once.
            </p>

            {c.status === "awaiting_address" ? (
              <form
                onSubmit={(e) => void submitAddress(e, c.id, "address")}
                className="flex flex-col gap-3"
              >
                <p className="text-sm font-medium">Update the address</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input name="addressLine1" required placeholder="Address line 1" defaultValue={recipient.addressLine1 ?? ""} className={inputClass} />
                  <input name="addressLine2" placeholder="Address line 2 (optional)" defaultValue={recipient.addressLine2 ?? ""} className={inputClass} />
                  <input name="addressCity" required placeholder="City" defaultValue={recipient.addressCity ?? ""} className={inputClass} />
                  <input name="addressPostcode" required placeholder="Postcode" defaultValue={recipient.addressPostcode ?? ""} className={inputClass} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="submit" disabled={busy} className="btn-accent">
                    {busy ? "Saving…" : "Update address"}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act(c.id, "archive")}
                    className="rounded-md border border-border px-3 py-2 text-sm hover:bg-foreground/[0.03] disabled:opacity-40"
                  >
                    Archive
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">Address updated — choose how to recover this card</p>
                {c.resend.birthdayPassed && (
                  <p className="rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900">
                    This birthday has already passed, so it can&apos;t be resent in time — you can still
                    have the original card hand-delivered to your business, or archive it.
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {!c.resend.birthdayPassed && (
                    <button
                      type="button"
                      disabled={busy || c.freeRecoveryUsed}
                      onClick={() => void act(c.id, "resend")}
                      className="btn-accent"
                    >
                      {busy ? "Working…" : "Resend to corrected address (free)"}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setBusinessFor((v) => (v === c.id ? null : c.id))}
                    className="btn-secondary text-sm"
                  >
                    Send to my business (free)
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act(c.id, "archive")}
                    className="rounded-md border border-border px-3 py-2 text-sm hover:bg-foreground/[0.03] disabled:opacity-40"
                  >
                    Archive
                  </button>
                </div>

                {businessFor === c.id && (
                  <form
                    onSubmit={(e) => void submitAddress(e, c.id, "send-to-business")}
                    className="flex flex-col gap-3 rounded-lg border border-border p-3"
                  >
                    <p className="text-sm font-medium">Your business address (for hand delivery)</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input name="addressLine1" required placeholder="Address line 1" className={inputClass} />
                      <input name="addressLine2" placeholder="Address line 2 (optional)" className={inputClass} />
                      <input name="addressCity" required placeholder="City" className={inputClass} />
                      <input name="addressPostcode" required placeholder="Postcode" className={inputClass} />
                    </div>
                    <button type="submit" disabled={busy} className="btn-accent self-start">
                      {busy ? "Working…" : "Send to my business"}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
