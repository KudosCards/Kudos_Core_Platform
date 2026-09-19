/**
 * Where a Kudos card can be posted.
 *
 * Cards are printed and posted in the United Kingdom, and only to UK addresses.
 * The **sender** can be anywhere: Stripe Checkout is created with no
 * `allowed_countries` and sign-up never asks for a country, so somebody in New
 * York sending to their mother in Leeds is a customer we already serve. Those
 * two facts live together because saying only the first turns that customer
 * away, and saying "UK customers only" would be false.
 *
 * Here rather than in either app because both need it and they must not drift —
 * the same reasoning `common/uk-postcode.ts` gives for re-exporting the postcode
 * regex rather than keeping a second copy. See docs/uk-scope-messaging-plan.md.
 */

/** ISO code we deliver to, and the default for `Recipient.addressCountry`. */
export const DELIVERY_COUNTRY_CODE = "GB";

/** The country in full, for markup and prose that should not say "GB". */
export const DELIVERY_COUNTRY_NAME = "United Kingdom";

/**
 * Every spelling of the United Kingdom we accept in a country field.
 *
 * Not pedantry — a live defect. `addressCountry` holds whatever the source
 * system had: the inbound API takes a free string, and the CRM mappers copy the
 * provider's own value, where HubSpot's standard `country` property reads
 * "United Kingdom" and others hold "UK" or a nation. Until this existed, the
 * send path compared that value to `"GB"` exactly, so a perfectly deliverable
 * contact synced from HubSpot was refused as a "Non-UK address (United
 * Kingdom)".
 *
 * The four nations are included because a country field saying "Scotland" is
 * describing a UK address, and a card to it posts exactly like any other.
 *
 * **Not included: Jersey, Guernsey and the Isle of Man.** Their postcodes pass
 * `ukPostcodeRegex`, so a contact there is mailable today via the null-country
 * path and this list does not change that either way. Whether we post there is
 * a fulfilment question, and adding them here would answer it by implication.
 */
export const UK_COUNTRY_VALUES = [
  "GB",
  "GBR",
  "UK",
  "United Kingdom",
  "Great Britain",
  "England",
  "Scotland",
  "Wales",
  "Northern Ireland",
] as const;

/**
 * Whether a stored country value means "in the UK".
 *
 * **Null and empty mean yes.** `addressCountry` is nullable with a `"GB"`
 * default, so every contact added by hand or imported from CSV before the
 * column was populated holds null. Reading that as foreign would make every one
 * of them unmailable — which is the single worst thing this rule could do.
 */
export function isUkCountry(value: string | null | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) {
    return true;
  }
  return UK_COUNTRY_VALUES.some((known) => known.toLowerCase() === trimmed.toLowerCase());
}
