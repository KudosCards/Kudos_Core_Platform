/**
 * Brevo contacts source, kept behind an interface + injectable token so the
 * real HTTP implementation can be swapped for a mock in tests — exactly the
 * pattern CATALOG_SOURCE / STRIPE_CLIENT use, since this build/test environment
 * has no network path to Brevo. See docs/adr/0015-crm-integrations.md.
 */
export const BREVO_CLIENT = Symbol("BREVO_CLIENT");

/** A Brevo contact, trimmed to what we read. `attributes` is Brevo's bag of
 * standard (FIRSTNAME, LASTNAME, …) and custom fields. */
export interface BrevoContact {
  id: number;
  email: string | null;
  attributes: Record<string, unknown>;
}

export interface BrevoClient {
  /** Cheap auth check (fetches one contact). Throws Unauthorized on a bad key
   * so `connect` can surface "that key didn't work" without pulling everything. */
  verifyKey(apiKey: string): Promise<void>;
  /** Fetches every contact the key can see (paginated internally). */
  fetchContacts(apiKey: string): Promise<BrevoContact[]>;
}
