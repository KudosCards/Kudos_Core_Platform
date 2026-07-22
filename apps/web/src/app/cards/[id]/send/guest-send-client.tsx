"use client";

import { useState, type FormEvent } from "react";
import type { GuestCheckoutResult } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { publicApiPost } from "@/lib/api.public";

const CORAL = "#ef5b52";
const inputClass =
  "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none";

/**
 * The guest one-off purchase form — buy and post a single card with no account.
 * Collects the recipient + delivery address + the buyer's email, then hands off
 * to Stripe Checkout (POST /guest/checkout). See docs/adr/0025.
 */
export function GuestSendClient({ cardId }: { cardId: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const data = new FormData(event.currentTarget);
    const line2 = String(data.get("shippingAddressLine2") ?? "").trim();
    const body = {
      cardDesignId: cardId,
      buyerEmail: String(data.get("buyerEmail") ?? "").trim(),
      recipientFirstName: String(data.get("recipientFirstName") ?? "").trim(),
      recipientLastName: String(data.get("recipientLastName") ?? "").trim(),
      shippingAddressLine1: String(data.get("shippingAddressLine1") ?? "").trim(),
      // Omit an empty line 2 — the API rejects an empty string (min length 1).
      ...(line2 && { shippingAddressLine2: line2 }),
      shippingAddressCity: String(data.get("shippingAddressCity") ?? "").trim(),
      shippingAddressPostcode: String(data.get("shippingAddressPostcode") ?? "").trim(),
    };

    try {
      const result = await publicApiPost<GuestCheckoutResult>("/guest/checkout", body);
      // Off to Stripe. On return the /gift/success page confirms + offers an account.
      window.location.assign(result.checkoutUrl);
    } catch (submitError) {
      setError(
        submitError instanceof ApiError
          ? submitError.message
          : "Something went wrong — please try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-5">
      {error && (
        <p className="rounded-lg bg-rose-50 px-4 py-2 text-sm font-medium text-rose-600">{error}</p>
      )}

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-slate-900">Who&apos;s it for?</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            First name
            <input name="recipientFirstName" required maxLength={120} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Last name
            <input name="recipientLastName" required maxLength={120} className={inputClass} />
          </label>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-slate-900">Where do we post it?</legend>
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          Address line 1
          <input name="shippingAddressLine1" required maxLength={200} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          Address line 2 <span className="text-slate-400">(optional)</span>
          <input name="shippingAddressLine2" maxLength={200} className={inputClass} />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Town / city
            <input name="shippingAddressCity" required maxLength={120} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-600">
            Postcode
            <input
              name="shippingAddressPostcode"
              required
              autoCapitalize="characters"
              className={inputClass}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-semibold text-slate-900">Your email</legend>
        <label className="flex flex-col gap-1 text-sm text-slate-600">
          For your receipt — and to save this card if you want an account later.
          <input name="buyerEmail" type="email" required className={inputClass} />
        </label>
      </fieldset>

      <button
        type="submit"
        disabled={submitting}
        className="mt-1 rounded-full px-6 py-3 text-center font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        style={{ backgroundColor: CORAL }}
      >
        {submitting ? "Taking you to checkout…" : "Continue to payment — £1.50"}
      </button>
      <p className="text-center text-xs text-slate-500">
        No account needed. Secure payment by Stripe. £1.50 includes VAT &amp; UK postage.
      </p>
    </form>
  );
}
