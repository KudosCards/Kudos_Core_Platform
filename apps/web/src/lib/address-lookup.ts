"use client";

/**
 * UK postcode lookup, provider-agnostic. The default implementation uses
 * postcodes.io — free, no API key, CORS-enabled — which validates a postcode and
 * returns its town/county from open ONS/OS data. That's enough to auto-fill the
 * town and confirm the postcode is real, cutting typos and friction when adding
 * a contact's address.
 *
 * House-level "pick 12 High Street" addresses need Royal Mail PAF data, which is
 * licensed and only available from keyed/paid providers. When
 * `NEXT_PUBLIC_IDEAL_POSTCODES_API_KEY` is set, `lookupAddresses` returns the
 * full address list from Ideal Postcodes (PAF-licensed) so the form can offer a
 * "select your address" step; with no key it returns null and the form falls
 * back to the free postcodes.io town autofill. See
 * docs/adr/0073-house-level-address-autocomplete.md.
 */

export interface PostcodeLookupResult {
  /** The canonicalised postcode (e.g. "LS1 1AA"). */
  postcode: string;
  /** Best available town/post-town proxy (admin district), or null. */
  town: string | null;
  /** County/region, or null. */
  county: string | null;
  /** Country (England, Scotland, Wales, Northern Ireland). */
  country: string;
}

interface PostcodesIoResponse {
  status: number;
  result: {
    postcode: string;
    admin_district: string | null;
    admin_county: string | null;
    region: string | null;
    country: string;
  } | null;
}

/**
 * Look up a UK postcode. Returns the canonical postcode + town/county when it's
 * a real postcode, or null when it isn't (or the service is unreachable — the
 * caller degrades to plain manual entry, never blocked on the network).
 */
export async function lookupPostcode(raw: string): Promise<PostcodeLookupResult | null> {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const response = await fetch(
      `https://api.postcodes.io/postcodes/${encodeURIComponent(trimmed)}`,
    );
    if (!response.ok) return null; // 404 = not a real postcode
    const body = (await response.json()) as PostcodesIoResponse;
    if (!body.result) return null;
    return {
      postcode: body.result.postcode,
      town: body.result.admin_district ?? null,
      county: body.result.admin_county ?? body.result.region ?? null,
      country: body.result.country,
    };
  } catch {
    // Offline / blocked / malformed response — fall back to manual entry.
    return null;
  }
}

/** One selectable full address returned by a house-level (PAF) lookup. */
export interface AddressSuggestion {
  line1: string;
  line2: string;
  town: string;
  postcode: string;
  /** A single-line label for the picker (e.g. "12 High Street, Leeds, LS1 1AA"). */
  label: string;
}

interface IdealPostcodesResponse {
  code: number;
  result?: {
    line_1: string;
    line_2?: string;
    line_3?: string;
    post_town: string;
    postcode: string;
  }[];
}

/** Whether a keyed house-level provider is configured (drives the form's UX). */
export function houseLevelLookupEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_IDEAL_POSTCODES_API_KEY);
}

/**
 * House-level address lookup via Ideal Postcodes (PAF). Returns the full list of
 * addresses at a postcode for the user to pick from, or `null` when no keyed
 * provider is configured or the lookup fails — callers then fall back to
 * `lookupPostcode` (town autofill). Autocomplete suggestions like this are free
 * on Ideal Postcodes; only resolving a chosen address bills. See ADR 0073.
 */
export async function lookupAddresses(raw: string): Promise<AddressSuggestion[] | null> {
  const apiKey = process.env.NEXT_PUBLIC_IDEAL_POSTCODES_API_KEY;
  if (!apiKey) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const response = await fetch(
      `https://api.ideal-postcodes.co.uk/v1/postcodes/${encodeURIComponent(
        trimmed,
      )}?api_key=${encodeURIComponent(apiKey)}`,
    );
    if (!response.ok) return null; // 404 = not a real postcode; 402 = out of credit
    const body = (await response.json()) as IdealPostcodesResponse;
    if (!body.result || body.result.length === 0) return null;
    return body.result.map((a) => {
      // PAF splits the street across line_1..line_3; join the extras into line 2.
      const line1 = a.line_1;
      const line2 = [a.line_2, a.line_3].filter(Boolean).join(", ");
      return {
        line1,
        line2,
        town: a.post_town,
        postcode: a.postcode,
        label: [line1, line2, a.post_town, a.postcode].filter(Boolean).join(", "),
      };
    });
  } catch {
    return null;
  }
}
