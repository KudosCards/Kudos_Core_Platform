"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { addToCart, CART_MAX_ITEMS } from "@/lib/cart";

const CORAL = "#ef5b52";
const inputClass =
  "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none";

/**
 * The guest "add this card to your basket" form — no account. Collects the
 * recipient + delivery address and adds the card to the localStorage basket,
 * then sends the visitor to /basket to add more or pay. The buyer's email is
 * collected once at basket checkout, not per card. See docs/adr/0025.
 */
export function GuestSendClient({
  cardId,
  cardName,
  thumbnailUrl,
}: {
  cardId: string;
  cardName: string;
  thumbnailUrl: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const data = new FormData(event.currentTarget);
    const line2 = String(data.get("shippingAddressLine2") ?? "").trim();
    const added = addToCart({
      cardDesignId: cardId,
      cardName,
      thumbnailUrl,
      recipientFirstName: String(data.get("recipientFirstName") ?? "").trim(),
      recipientLastName: String(data.get("recipientLastName") ?? "").trim(),
      shippingAddressLine1: String(data.get("shippingAddressLine1") ?? "").trim(),
      ...(line2 && { shippingAddressLine2: line2 }),
      shippingAddressCity: String(data.get("shippingAddressCity") ?? "").trim(),
      shippingAddressPostcode: String(data.get("shippingAddressPostcode") ?? "").trim(),
    });

    if (!added) {
      setError(`Your basket is full (max ${CART_MAX_ITEMS} cards). Check out first, then add more.`);
      return;
    }
    router.push("/basket");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
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

      <button
        type="submit"
        className="mt-1 rounded-full px-6 py-3 text-center font-semibold text-white transition-opacity hover:opacity-90"
        style={{ backgroundColor: CORAL }}
      >
        Add to basket — £2.50
      </button>
      <p className="text-center text-xs text-slate-500">
        No account needed. £2.50 a card includes VAT &amp; UK postage. Pay securely at the basket.
      </p>
    </form>
  );
}
