"use client";

import { useState } from "react";
import { lookupPostcode } from "@/lib/address-lookup";

/**
 * A reusable UK address block: postcode + "Find address" (validates via the free
 * postcodes.io lookup and auto-fills the town), line 1, optional line 2, and
 * town/city. Renders `name`-attributed inputs so it drops into any FormData-based
 * form (addressLine1 / addressLine2 / addressCity / addressPostcode). Controlled
 * internally so the lookup can populate fields; remount with a changing `key` to
 * reset after submit. See docs/adr/0067-mandatory-addresses.md.
 */
export function AddressFields({
  defaults,
  required = true,
}: {
  defaults?: {
    addressLine1?: string | null;
    addressLine2?: string | null;
    addressCity?: string | null;
    addressPostcode?: string | null;
  };
  required?: boolean;
}) {
  const [line1, setLine1] = useState(defaults?.addressLine1 ?? "");
  const [line2, setLine2] = useState(defaults?.addressLine2 ?? "");
  const [city, setCity] = useState(defaults?.addressCity ?? "");
  const [postcode, setPostcode] = useState(defaults?.addressPostcode ?? "");
  const [looking, setLooking] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const inputClass = "rounded-md border border-border bg-surface px-3 py-2 text-sm";

  async function findAddress() {
    const trimmed = postcode.trim();
    if (!trimmed) return;
    setLooking(true);
    setMessage(null);
    const result = await lookupPostcode(trimmed);
    setLooking(false);
    if (!result) {
      setMessage({
        tone: "warn",
        text: "We couldn't find that postcode — check it, or type the address in manually.",
      });
      return;
    }
    setPostcode(result.postcode);
    if (result.town && !city.trim()) {
      setCity(result.town);
    }
    setMessage({
      tone: "ok",
      text: `Postcode confirmed${result.town ? ` (${result.town})` : ""} — add the house number and street below.`,
    });
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="flex gap-2 sm:col-span-2">
        <input
          name="addressPostcode"
          value={postcode}
          onChange={(e) => setPostcode(e.target.value)}
          placeholder="Postcode"
          autoComplete="postal-code"
          required={required}
          className={`${inputClass} flex-1 uppercase placeholder:normal-case`}
        />
        <button
          type="button"
          onClick={() => void findAddress()}
          disabled={looking || !postcode.trim()}
          className="btn-secondary shrink-0 text-sm disabled:opacity-50"
        >
          {looking ? "Finding…" : "Find address"}
        </button>
      </div>
      <input
        name="addressLine1"
        value={line1}
        onChange={(e) => setLine1(e.target.value)}
        placeholder="Address line 1 (house number & street)"
        autoComplete="address-line1"
        required={required}
        className={`${inputClass} sm:col-span-2`}
      />
      <input
        name="addressLine2"
        value={line2}
        onChange={(e) => setLine2(e.target.value)}
        placeholder="Address line 2 (optional)"
        autoComplete="address-line2"
        className={`${inputClass} sm:col-span-2`}
      />
      <input
        name="addressCity"
        value={city}
        onChange={(e) => setCity(e.target.value)}
        placeholder="Town / city"
        autoComplete="address-level2"
        required={required}
        className={`${inputClass} sm:col-span-2`}
      />
      {message && (
        <p
          className={`text-xs sm:col-span-2 ${message.tone === "ok" ? "text-[#2f7d54]" : "text-amber-700"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
