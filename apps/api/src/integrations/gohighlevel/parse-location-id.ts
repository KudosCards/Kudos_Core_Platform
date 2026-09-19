import { BadRequestException } from "@nestjs/common";
import { crmProviderLabel } from "@kudos/shared-types";

/**
 * The sub-account a Private Integration Token reads from.
 *
 * Every contacts call carries a `locationId`, and a Private Integration Token —
 * unlike an OAuth grant, whose token exchange returns it — does not say what
 * its own is. So the customer has to supply it, and the one place they are told
 * to find it is their own dashboard URL:
 *
 *     https://app.gohighlevel.com/v2/location/ve9EPM428h8vShlRW1KT/dashboard
 *
 * Asking for "the bit after /location/" and then rejecting the URL it came from
 * is the kind of small cruelty that turns a two-minute setup into a support
 * thread, so this takes either. Same reasoning as the CleanCloud address
 * parser: meet the value in the shape it actually arrives in.
 *
 * See ADR 0253.
 */

/** The segment after `/location/` in a HighLevel dashboard URL. */
const LOCATION_IN_URL = /\/location\/([A-Za-z0-9_-]+)/;

/**
 * Ids are opaque strings. Deliberately loose — bounded length, and the
 * characters that can appear in a URL path segment without escaping.
 *
 * Every id seen in the wild is alphanumeric, and the temptation is to write
 * that down. But a rule tighter than the provider's own turns a working id into
 * a refusal we invented, and this one cannot be checked against the provider's
 * documentation from here. The next line does the real work: the token is
 * verified **against this sub-account** before anything is stored, so a wrong
 * id fails in the same breath with a message from HighLevel itself. This only
 * has to catch a sentence, a path, or an empty box.
 */
const BARE_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function parseLocationId(raw: string | null | undefined): string {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) {
    throw refusal("Enter the sub-account ID, or paste the address of its dashboard.");
  }

  const fromUrl = LOCATION_IN_URL.exec(trimmed);
  if (fromUrl?.[1]) {
    return fromUrl[1];
  }
  if (BARE_ID.test(trimmed)) {
    return trimmed;
  }

  // Deliberately not "invalid". A URL for the wrong page is the likely mistake
  // — an agency dashboard, or a settings page — and "that address has no
  // sub-account in it" is the sentence that gets somebody to the right one.
  throw refusal(
    trimmed.includes("/")
      ? "That address doesn't contain a sub-account ID. Open the sub-account's dashboard and " +
          "copy the address from there — the ID is the part after /location/."
      : "That doesn't look like a sub-account ID. It is the part after /location/ in the " +
          "address of your sub-account's dashboard.",
  );
}

function refusal(detail: string): BadRequestException {
  return new BadRequestException(`${crmProviderLabel("gohighlevel")} sub-account: ${detail}`);
}
