"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import type { GuestCartCheckoutInput, GuestCheckoutResult } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { publicApiPost } from "@/lib/api.public";
import { CARD_PRICE_PENCE, removeFromCart, useCart, type CartItem } from "@/lib/cart";

const CORAL = "#ef5b52";

function formatGBP(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

function toApiItem(item: CartItem): GuestCartCheckoutInput["items"][number] {
  return {
    cardDesignId: item.cardDesignId,
    recipientFirstName: item.recipientFirstName,
    recipientLastName: item.recipientLastName,
    shippingAddressLine1: item.shippingAddressLine1,
    ...(item.shippingAddressLine2 && { shippingAddressLine2: item.shippingAddressLine2 }),
    shippingAddressCity: item.shippingAddressCity,
    shippingAddressPostcode: item.shippingAddressPostcode,
  };
}

/** The guest basket: the cards added so far, plus the one-step pay-for-all
 * checkout (POST /guest/cart-checkout → Stripe). See docs/adr/0025. */
export function BasketClient() {
  const items = useCart();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = items.length * CARD_PRICE_PENCE;

  async function handleCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const data = new FormData(event.currentTarget);
    const body: GuestCartCheckoutInput = {
      buyerEmail: String(data.get("buyerEmail") ?? "").trim(),
      items: items.map(toApiItem),
    };

    try {
      const result = await publicApiPost<GuestCheckoutResult>("/guest/cart-checkout", body);
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

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-slate-100 bg-slate-50 px-6 py-16 text-center">
        <p className="text-lg font-semibold text-slate-900">Your basket is empty</p>
        <p className="mt-1 text-sm text-slate-600">
          Browse the card library, personalise a card for someone, and it&apos;ll appear here.
        </p>
        <Link
          href="/cards"
          className="mt-5 inline-block rounded-full px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: CORAL }}
        >
          Browse cards
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <ul className="flex flex-col gap-4">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
          >
            <div className="relative aspect-[3/4] h-24 shrink-0 overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-100">
              <Image src={item.thumbnailUrl} alt={item.cardName} fill unoptimized className="object-cover" />
            </div>
            <div className="flex flex-1 flex-col">
              <p className="font-semibold text-slate-900">{item.cardName}</p>
              <p className="text-sm text-slate-600">
                To: {item.recipientFirstName} {item.recipientLastName}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {item.shippingAddressLine1}
                {item.shippingAddressLine2 ? `, ${item.shippingAddressLine2}` : ""},{" "}
                {item.shippingAddressCity}, {item.shippingAddressPostcode.toUpperCase()}
              </p>
              <div className="mt-auto flex items-center justify-between pt-2">
                <span className="text-sm font-semibold text-slate-900">
                  {formatGBP(CARD_PRICE_PENCE)}
                </span>
                <button
                  type="button"
                  onClick={() => removeFromCart(item.id)}
                  className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-rose-600 hover:underline"
                >
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
        <Link href="/cards" className="text-sm font-medium text-rose-600 hover:underline">
          + Add another card
        </Link>
      </ul>

      <form
        onSubmit={(event) => void handleCheckout(event)}
        className="flex h-fit flex-col gap-4 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm lg:sticky lg:top-24"
      >
        <h2 className="text-lg font-bold text-slate-900">Order summary</h2>
        <div className="flex justify-between text-sm text-slate-600">
          <span>
            {items.length} {items.length === 1 ? "card" : "cards"} × {formatGBP(CARD_PRICE_PENCE)}
          </span>
          <span>{formatGBP(total)}</span>
        </div>
        <div className="flex justify-between border-t border-slate-100 pt-3 text-base font-bold text-slate-900">
          <span>Total</span>
          <span>{formatGBP(total)}</span>
        </div>
        <p className="text-xs text-slate-500">Includes VAT &amp; UK postage.</p>

        <label className="flex flex-col gap-1 text-sm text-slate-600">
          Your email
          <input
            name="buyerEmail"
            type="email"
            required
            placeholder="you@example.com"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
          />
          <span className="text-xs text-slate-400">
            For your receipt — and to save these cards if you want an account later.
          </span>
        </label>

        {error && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-full px-6 py-3 text-center font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ backgroundColor: CORAL }}
        >
          {submitting ? "Taking you to checkout…" : `Pay ${formatGBP(total)}`}
        </button>
        <p className="text-center text-xs text-slate-500">
          Secure payment by Stripe. No account needed.
        </p>
      </form>
    </div>
  );
}
