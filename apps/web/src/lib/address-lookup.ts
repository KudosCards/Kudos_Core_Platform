"use client";

/**
 * UK postcode lookup, provider-agnostic. The default implementation uses
 * postcodes.io — free, no API key, CORS-enabled — which validates a postcode and
 * returns its town/county from open ONS/OS data. That's enough to auto-fill the
 * town and confirm the postcode is real, cutting typos and friction when adding
 * a contact's address.
 *
 * It does NOT return house-level addresses ("pick 12 High Street") — that data
 * is Royal Mail PAF-licensed and only available from keyed/paid providers. When
 * we add one, swap the fetch below (keep the return shape) and the address form
 * gains a "select your address" step with no other change. See
 * docs/adr/0067-mandatory-addresses.md.
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
