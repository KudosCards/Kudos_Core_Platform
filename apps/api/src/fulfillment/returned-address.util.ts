/**
 * Whether a queued card is addressed to somewhere Royal Mail already sent back.
 *
 * Kept in the API rather than shared-types deliberately: the web never decides
 * this, it is told. Every surface that could act on a held card — the export,
 * the print sheet, the status transition, the Click & Drop push — is server-side,
 * so one implementation here is the whole rule.
 *
 * See docs/returned-address-hold-plan.md.
 */

/** The parts of an address that decide whether two are the same place. */
export interface AddressParts {
  shippingAddressLine1: string;
  shippingAddressPostcode: string;
}

/**
 * A comparable key for an address.
 *
 * Line 1 and the postcode, case-folded with runs of whitespace collapsed — the
 * two fields that actually discriminate a delivery point. City is left out
 * because it is the field people spell differently for the same place ("Hull",
 * "Kingston upon Hull"), and a difference there must not be read as a different
 * address. Line 2 is left out for the same reason: "Flat 2" and "Apt 2" are one
 * doorway.
 */
export function addressKey(address: AddressParts): string {
  const norm = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();
  return `${norm(address.shippingAddressLine1)}|${norm(address.shippingAddressPostcode)}`;
}

/**
 * Whether this card is going to one of the addresses that came back.
 *
 * Keyed on the address rather than on the contact's `addressVerificationRequired`
 * flag, because that flag is cleared by archiving a return case — which a
 * customer can do without ever correcting the address. Archiving means "I don't
 * want this card back"; it does not mean the address is good. See D1.
 */
export function isReturnedAddress(
  card: AddressParts,
  returnedAddresses: readonly AddressParts[],
): boolean {
  if (returnedAddresses.length === 0) return false;
  const key = addressKey(card);
  return returnedAddresses.some((returned) => addressKey(returned) === key);
}
