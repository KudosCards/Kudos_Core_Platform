/**
 * Whether a contact has an address we could actually post a card to.
 *
 * One rule, shared, because three copies of it had already drifted: the API's
 * auto-send gate tested falsiness, the ops "missing address" query tested null
 * or empty, and the contact screen trimmed first — so an address of three
 * spaces was complete to two of them and missing to the third.
 *
 * That mattered the moment the approvals queue began defaulting auto-send on
 * for contacts it believed were postable: a client that disagrees with the
 * server about this offers a checkbox that is guaranteed to fail on submit.
 * The two have to be the same sentence, so they are.
 *
 * Trimmed, which is the strict reading and the right one — whitespace is not an
 * address. Line 2 and country are deliberately not required: plenty of UK
 * addresses have neither, and the country defaults where the send path needs
 * it.
 */
export function hasPostalAddress(
  recipient:
    | {
        addressLine1?: string | null;
        addressCity?: string | null;
        addressPostcode?: string | null;
      }
    | null
    | undefined,
): boolean {
  if (!recipient) return false;
  return Boolean(
    recipient.addressLine1?.trim() &&
    recipient.addressCity?.trim() &&
    recipient.addressPostcode?.trim(),
  );
}
