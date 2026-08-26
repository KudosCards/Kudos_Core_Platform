"use client";

import { useState } from "react";
import { lookupAddresses, lookupPostcode, type AddressSuggestion } from "@/lib/address-lookup";

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
  namePrefix = "address",
}: {
  defaults?: {
    addressLine1?: string | null;
    addressLine2?: string | null;
    addressCity?: string | null;
    addressPostcode?: string | null;
  };
  required?: boolean;
  /**
   * Base for the input `name`s so the block fits forms with different field
   * names. Default "address" emits addressLine1/…; pass "shippingAddress" for
   * the guest/checkout shipping-address forms (shippingAddressLine1/…).
   */
  namePrefix?: "address" | "shippingAddress";
}) {
  const [line1, setLine1] = useState(defaults?.addressLine1 ?? "");
  const [line2, setLine2] = useState(defaults?.addressLine2 ?? "");
  const [city, setCity] = useState(defaults?.addressCity ?? "");
  const [postcode, setPostcode] = useState(defaults?.addressPostcode ?? "");
  const [looking, setLooking] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  // House-level candidates from a keyed provider (Ideal Postcodes); empty = the
  // free town-only fallback was used or no provider is configured.
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);

  const inputClass = "rounded-md border border-border bg-surface px-3 py-2 text-sm";

  function selectSuggestion(value: string) {
    const chosen = suggestions.find((s) => s.label === value);
    if (!chosen) return;
    setLine1(chosen.line1);
    setLine2(chosen.line2);
    setCity(chosen.town);
    setPostcode(chosen.postcode);
    setMessage({ tone: "ok", text: "Address filled in — check it and continue." });
  }

  async function findAddress() {
    const trimmed = postcode.trim();
    if (!trimmed) return;
    setLooking(true);
    setMessage(null);
    setSuggestions([]);

    // Prefer a house-level lookup when a keyed provider is configured; it lets
    // the user pick their exact address. Falls through to town-only otherwise.
    const addresses = await lookupAddresses(trimmed);
    if (addresses && addresses.length > 0) {
      setLooking(false);
      setSuggestions(addresses);
      setPostcode(addresses[0]!.postcode);
      setMessage({ tone: "ok", text: `Found ${addresses.length} addresses — pick yours below.` });
      return;
    }

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
          name={`${namePrefix}Postcode`}
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
      {suggestions.length > 0 && (
        <label className="flex flex-col gap-1 text-xs text-foreground/60 sm:col-span-2">
          Choose your address
          <select
            defaultValue=""
            onChange={(e) => selectSuggestion(e.target.value)}
            className={inputClass}
          >
            <option value="" disabled>
              Select an address…
            </option>
            {suggestions.map((s) => (
              <option key={s.label} value={s.label}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <input
        name={`${namePrefix}Line1`}
        value={line1}
        onChange={(e) => setLine1(e.target.value)}
        placeholder="Address line 1 (house number & street)"
        autoComplete="address-line1"
        required={required}
        className={`${inputClass} sm:col-span-2`}
      />
      <input
        name={`${namePrefix}Line2`}
        value={line2}
        onChange={(e) => setLine2(e.target.value)}
        placeholder="Address line 2 (optional)"
        autoComplete="address-line2"
        className={`${inputClass} sm:col-span-2`}
      />
      <input
        name={`${namePrefix}City`}
        value={city}
        onChange={(e) => setCity(e.target.value)}
        placeholder="Town / city"
        autoComplete="address-level2"
        required={required}
        className={`${inputClass} sm:col-span-2`}
      />
      {message && (
        <p
          className={`text-xs sm:col-span-2 ${message.tone === "ok" ? "text-success" : "text-amber-700"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
