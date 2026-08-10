/**
 * Pushes a Kudos Cards *subscriber* into our own company Brevo account as a
 * marketing contact, on the right list. This is the OPPOSITE direction from the
 * per-customer CRM Brevo client (integrations/brevo, which *reads* a customer's
 * own contacts): here we use our PLATFORM Brevo key to write our subscribers
 * into our marketing lists. Kept behind an interface + injectable token so the
 * real HTTP implementation is swapped for a mock in tests — the same pattern as
 * EMAIL_CLIENT / STRIPE_CLIENT, since this build/test environment has no network
 * path to Brevo. See docs/adr/0152-subscriber-marketing-lists.md.
 */
export const MARKETING_CONTACTS_CLIENT = Symbol("MARKETING_CONTACTS_CLIENT");

/** A single subscriber to upsert into a Brevo marketing list. `email` is the
 * contact key (Brevo dedupes/updates on it); the name fields map to Brevo's
 * standard FIRSTNAME / LASTNAME / COMPANY attributes. */
export interface MarketingContactInput {
  email: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  /** The Brevo list id to add the contact to (e.g. individuals vs organisations). */
  listId: number;
}

export interface MarketingContactsClient {
  /** Create or update the contact and add it to `listId`. Idempotent on email —
   * a repeat call updates the same Brevo contact rather than erroring. */
  upsertContact(input: MarketingContactInput): Promise<void>;
}
