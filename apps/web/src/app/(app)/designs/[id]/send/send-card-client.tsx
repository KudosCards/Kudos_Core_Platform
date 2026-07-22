"use client";

import type { BatchOrder } from "@kudos/shared-types";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

/** Card price and postage in pence, for the on-screen estimate. The server is
 * authoritative — Stripe shows the exact total, and plan discounts (Pro/Centre)
 * are applied there — so this is labelled an estimate. Mirrors the marketing
 * page's headline pricing. */
const CARD_MINOR = 150;
const POSTAGE_MINOR: Record<string, number> = { second_class: 91, first_class: 180 };
const POSTAGE_LABEL: Record<string, string> = {
  second_class: "2nd class (2–3 days)",
  first_class: "1st class (next day)",
};

function gbp(minor: number): string {
  return `£${(minor / 100).toFixed(2)}`;
}

export function SendCardClient({ designId, designName }: { designId: string; designName: string }) {
  const [postageClass, setPostageClass] = useState<"second_class" | "first_class">("second_class");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const estimate = CARD_MINOR + (POSTAGE_MINOR[postageClass] ?? 0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    const str = (key: string) => String(data.get(key) || "").trim();

    setBusy(true);
    try {
      // Prepare the order (recipient + approved occasion + draft order)…
      const order = await clientApiFetch<BatchOrder>("/batch-orders/quick-send", {
        method: "POST",
        body: JSON.stringify({
          savedDesignId: designId,
          firstName: str("firstName"),
          lastName: str("lastName"),
          shippingAddressLine1: str("shippingAddressLine1"),
          ...(str("shippingAddressLine2") && { shippingAddressLine2: str("shippingAddressLine2") }),
          shippingAddressCity: str("shippingAddressCity"),
          shippingAddressPostcode: str("shippingAddressPostcode"),
          postageClass,
        }),
      });

      // …then hand off to the same Stripe checkout the manual flow uses.
      const { checkoutUrl } = await clientApiFetch<{ checkoutUrl: string }>(
        `/batch-orders/${order.id}/checkout`,
        { method: "POST" },
      );
      window.location.href = checkoutUrl;
    } catch (submitError) {
      setError(
        submitError instanceof ApiError ? submitError.message : "Something went wrong — please try again.",
      );
      setBusy(false);
    }
  }

  const inputClass = "rounded-md border border-border bg-surface px-3 py-2 text-sm";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={`/designs/${designId}/edit`} className="text-sm text-muted hover:text-foreground">
          ← Back to editing
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">Send your card</h1>
        <p className="text-muted">
          Tell us who it&apos;s for and we&apos;ll print &amp; post a real card to their door.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
      )}

      <form onSubmit={(event) => void handleSubmit(event)} className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="card flex flex-col gap-4 p-6">
          <h2 className="font-semibold">Who&apos;s this card for?</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">First name</span>
              <input name="firstName" required className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Last name</span>
              <input name="lastName" required className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="text-muted">Address line 1</span>
              <input name="shippingAddressLine1" required className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="text-muted">Address line 2 (optional)</span>
              <input name="shippingAddressLine2" className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Town / city</span>
              <input name="shippingAddressCity" required className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">Postcode</span>
              <input name="shippingAddressPostcode" required className={inputClass} />
            </label>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">Postage</legend>
            {(["second_class", "first_class"] as const).map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="postage"
                  checked={postageClass === option}
                  onChange={() => setPostageClass(option)}
                />
                <span>{POSTAGE_LABEL[option]}</span>
                <span className="text-muted">{gbp(POSTAGE_MINOR[option] ?? 0)}</span>
              </label>
            ))}
          </fieldset>
        </div>

        <div className="card flex h-fit flex-col gap-4 p-6">
          <h2 className="font-semibold">Order summary</h2>
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">{designName}</span>
              <span>{gbp(CARD_MINOR)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Postage — {POSTAGE_LABEL[postageClass]}</span>
              <span>{gbp(POSTAGE_MINOR[postageClass] ?? 0)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-border pt-2 font-semibold">
              <span>Estimated total</span>
              <span>{gbp(estimate)}</span>
            </div>
          </div>
          <p className="text-xs text-muted">
            Card price includes VAT. Any plan discount and the exact total are shown on the secure
            payment page.
          </p>
          <button type="submit" disabled={busy} className="btn-accent w-full">
            {busy ? "Taking you to payment…" : "Pay & send →"}
          </button>
          <p className="text-center text-xs text-muted">Secure payment powered by Stripe</p>
        </div>
      </form>
    </div>
  );
}
