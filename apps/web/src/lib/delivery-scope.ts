/**
 * Where a Kudos card can be posted, and who can send one.
 *
 * Two different facts, and the whole reason this file exists is that the site
 * spent a long time saying neither:
 *
 * - **Cards are posted to UK addresses.** Enforced end to end — `ukPostcodeRegex`
 *   on every address field, and `batch-orders.service.ts` refuses a recipient
 *   whose `addressCountry` is not GB.
 * - **The sender can be anywhere.** Not enforced, because there is nothing to
 *   enforce: Stripe Checkout is created with no `allowed_countries`, and sign-up
 *   never asks for a country. Somebody in New York sending to their mother in
 *   Leeds is a customer we already serve.
 *
 * Saying only the first turns that customer away; saying "UK customers only"
 * would be false as well as expensive. Every place that tells somebody about
 * delivery scope reads from here, so the two facts cannot drift apart or be
 * half-told. See docs/uk-scope-messaging-plan.md.
 */

/** ISO country code we deliver to, for schema.org and address defaults. */
export const DELIVERY_COUNTRY_CODE = "GB";

/** The country in full, for markup and prose that should not say "GB". */
export const DELIVERY_COUNTRY_NAME = "United Kingdom";

/**
 * Shown when somebody enters something that is not a UK postcode.
 *
 * It names our scope rather than their mistake — they did not mistype, they did
 * not know — and then says the thing that keeps them: the restriction is on
 * where the card lands, not on where they are.
 */
export const NOT_A_UK_POSTCODE =
  "We post cards to UK addresses only, so this needs a UK postcode. " +
  "You can order from anywhere in the world — it's the delivery address that has to be in the UK.";
