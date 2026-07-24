"use client";

import type { ReturnCase } from "@kudos/shared-types";
import { useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api";
import { publicApiPost } from "@/lib/api.public";

const REASON_LABELS: Record<string, string> = {
  moved: "the recipient has moved",
  incomplete_address: "the address was incomplete",
  incorrect_address: "the address was incorrect",
  undeliverable: "delivery wasn't possible",
  other: "it was returned by Royal Mail",
};

const inputClass = "rounded-md border border-border bg-surface px-3 py-2 text-sm";

/**
 * Token-authenticated recovery flow shown on the public /rts/[token] page:
 * update the address, then take the one free Kudos Promise recovery (resend /
 * hand-deliver) or archive. Mirrors the in-app panel but needs no login. See
 * docs/adr/0039-returned-to-sender.md.
 */
export function RtsRecoveryClient({
  token,
  initialCase,
}: {
  token: string;
  initialCase: ReturnCase;
}) {
  const [rtsCase, setRtsCase] = useState<ReturnCase>(initialCase);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showBusiness, setShowBusiness] = useState(false);

  async function act(path: string, body?: unknown): Promise<void> {
    setError(null);
    setPending(true);
    try {
      const updated = await publicApiPost<ReturnCase>(`/rts/${token}/${path}`, body ?? {});
      setRtsCase(updated);
      setShowBusiness(false);
    } catch (actError) {
      setError(actError instanceof ApiError ? actError.message : "Something went wrong");
    } finally {
      setPending(false);
    }
  }

  function submitAddress(event: FormEvent<HTMLFormElement>, path: string) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const str = (k: string) => String(data.get(k) || "").trim();
    void act(path, {
      addressLine1: str("addressLine1"),
      ...(str("addressLine2") && { addressLine2: str("addressLine2") }),
      addressCity: str("addressCity"),
      addressPostcode: str("addressPostcode"),
    });
  }

  // Terminal states — the customer is done.
  if (rtsCase.status === "resolved" || rtsCase.status === "archived") {
    const resent = rtsCase.resolution === "resend_recipient" || rtsCase.resolution === "send_business";
    return (
      <div className="card flex flex-col items-center gap-3 p-8 text-center">
        <span aria-hidden className="text-3xl">
          {resent ? "✅" : "👍"}
        </span>
        <h1 className="text-xl font-bold">
          {resent ? "That's sorted — thank you" : "All done"}
        </h1>
        <p className="text-sm text-muted">
          {rtsCase.resolution === "send_business"
            ? `We'll hand-deliver ${rtsCase.recipientName}'s card to your business address. That's your free Kudos Promise recovery.`
            : rtsCase.resolution === "resend_recipient"
              ? `We're sending ${rtsCase.recipientName}'s card again, free of charge, to the corrected address. That's your free Kudos Promise recovery.`
              : "This return has been archived. No card will be sent."}
        </p>
      </div>
    );
  }

  return (
    <div className="card flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">A card to {rtsCase.recipientName} came back</h1>
        <p className="text-sm text-muted">
          We couldn&apos;t deliver it because {REASON_LABELS[rtsCase.reason] ?? "it was returned"}. As
          part of our Kudos Promise, we&apos;ll resend it <strong>free of charge</strong> once you
          confirm the address.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
      )}

      {rtsCase.status === "awaiting_address" ? (
        <form onSubmit={(e) => submitAddress(e, "address")} className="flex flex-col gap-3">
          <p className="text-sm font-medium">Update the delivery address</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <input name="addressLine1" required placeholder="Address line 1" className={inputClass} />
            <input name="addressLine2" placeholder="Address line 2 (optional)" className={inputClass} />
            <input name="addressCity" required placeholder="City" className={inputClass} />
            <input name="addressPostcode" required placeholder="Postcode" className={inputClass} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending} className="btn-accent">
              {pending ? "Saving…" : "Save address"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void act("archive")}
              className="rounded-md border border-border px-3 py-2 text-sm hover:bg-foreground/[0.03] disabled:opacity-40"
            >
              No longer needed — archive
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">Address updated — how should we recover this card?</p>
          {rtsCase.resend.birthdayPassed && (
            <p className="rounded-md bg-amber-100 px-3 py-2 text-xs text-amber-900">
              This birthday has already passed, so it can&apos;t arrive in time — but we can still
              hand-deliver the original card to your business, or you can archive it.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {!rtsCase.resend.birthdayPassed && (
              <button
                type="button"
                disabled={pending}
                onClick={() => void act("resend")}
                className="btn-accent"
              >
                {pending ? "Working…" : "Resend to the corrected address (free)"}
              </button>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => setShowBusiness((v) => !v)}
              className="btn-secondary text-sm"
            >
              Send to my business (free)
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void act("archive")}
              className="rounded-md border border-border px-3 py-2 text-sm hover:bg-foreground/[0.03] disabled:opacity-40"
            >
              Archive
            </button>
          </div>

          {showBusiness && (
            <form
              onSubmit={(e) => submitAddress(e, "send-to-business")}
              className="flex flex-col gap-3 rounded-lg border border-border p-3"
            >
              <p className="text-sm font-medium">Your business address (for hand delivery)</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <input name="addressLine1" required placeholder="Address line 1" className={inputClass} />
                <input name="addressLine2" placeholder="Address line 2 (optional)" className={inputClass} />
                <input name="addressCity" required placeholder="City" className={inputClass} />
                <input name="addressPostcode" required placeholder="Postcode" className={inputClass} />
              </div>
              <button type="submit" disabled={pending} className="btn-accent self-start">
                {pending ? "Working…" : "Send to my business"}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
