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

/** A return case, reduced to what the hold needs: whose it was, and where it
 * came back from. */
export interface ReturnedCard {
  recipientId: string;
  orderRecipient: AddressParts;
}

/** A card the hold can be asked about: whose it is, and where it is going. */
export interface CardForContact {
  orderRecipient: AddressParts & { recipientId: string };
}

/**
 * The addresses each contact has had a card returned from.
 *
 * Built once here rather than at each call site. It was written twice within a
 * day of #455 removing exactly this shape of duplication from the print rules —
 * the pure comparison was shared, and the lookup wrapped around it was copied.
 */
export function returnedAddressesByRecipient(
  cases: readonly ReturnedCard[],
): Map<string, AddressParts[]> {
  const byRecipient = new Map<string, AddressParts[]>();
  for (const returned of cases) {
    const list = byRecipient.get(returned.recipientId) ?? [];
    list.push(returned.orderRecipient);
    byRecipient.set(returned.recipientId, list);
  }
  return byRecipient;
}

/** Whether this card is going to somewhere its own contact's card came back
 * from. Scoped to the contact (D6): a different contact at that address is
 * usually a household one person has moved out of. */
export function isHeldCard(
  card: CardForContact,
  returnedByRecipient: Map<string, AddressParts[]>,
): boolean {
  return isReturnedAddress(
    card.orderRecipient,
    returnedByRecipient.get(card.orderRecipient.recipientId) ?? [],
  );
}
