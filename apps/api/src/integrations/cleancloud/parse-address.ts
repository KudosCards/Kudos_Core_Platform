import { findUkPostcode } from "@kudos/shared-types";

/**
 * Turning CleanCloud's single `customerAddress` string into the four columns a
 * card is printed from.
 *
 * Every other CRM we read hands over structured address fields. CleanCloud
 * keeps one free-text box, so this is a parse, and a parse of human-typed text
 * is never going to be perfect. What it CAN be is honest: where the input does
 * not support a confident answer, the field comes back null, the contact still
 * imports, and `readinessFor` counts it as not-yet-postable so the customer can
 * see and fix it. A plausible-looking guess would instead put a card in the
 * post to a street that does not exist.
 *
 * That is why the town is taken only from a comma-delimited part, never from
 * the last word before the postcode: "12 Acacia Avenue SW1A 1AA" would yield
 * the town "Avenue", which looks right on a screen and is wrong on an envelope.
 */

/** Column limits from `recipientSchema` — a longer value imports fine and then
 * fails when the web parses the contact back out. */
const LINE_LIMIT = 200;
const CITY_LIMIT = 120;

export interface ParsedAddress {
  addressLine1: string | null;
  addressLine2: string | null;
  addressCity: string | null;
  addressPostcode: string | null;
}

const EMPTY: ParsedAddress = {
  addressLine1: null,
  addressLine2: null,
  addressCity: null,
  addressPostcode: null,
};

export function parseAddress(raw: string | null | undefined): ParsedAddress {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return EMPTY;
  }

  const found = findUkPostcode(raw);
  // Anything after the postcode is a country or a note ("…, SW1A 1AA, United
  // Kingdom") — never part of the street address, so it is dropped rather than
  // shifted into a line.
  const beforePostcode = found ? raw.slice(0, found.start) : raw;

  const parts = splitParts(beforePostcode);
  const [line1, ...rest] = parts;
  // Two or more parts: the last is the town, by the same convention people
  // write addresses in. One part: a street with nowhere named, so no town.
  const city = rest.length > 0 ? rest[rest.length - 1] : undefined;
  const middle = rest.slice(0, -1);

  return {
    addressLine1: cap(line1, LINE_LIMIT),
    addressLine2: cap(middle.join(", "), LINE_LIMIT),
    addressCity: cap(city, CITY_LIMIT),
    addressPostcode: found ? normalisePostcode(found.postcode) : null,
  };
}

/**
 * Commas and line breaks separate the parts of an address; whitespace does not.
 * Empty parts are dropped, so a trailing comma or a blank line costs nothing.
 */
function splitParts(text: string): string[] {
  return text
    .split(/[,\n\r]+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 0);
}

/**
 * The conventional printed form: upper case, one space before the final three
 * characters. Royal Mail's own format, and the form the rest of the platform
 * stores — a postcode that round-trips differently is a contact that looks
 * edited every time it syncs.
 */
function normalisePostcode(postcode: string): string {
  const compact = postcode.replace(/\s+/g, "").toUpperCase();
  return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
}

function cap(value: string | undefined, limit: number): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > limit ? trimmed.slice(0, limit).trimEnd() : trimmed;
}
