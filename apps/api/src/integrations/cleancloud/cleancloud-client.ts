/**
 * CleanCloud customers source, behind an interface + injectable token so the
 * real HTTP implementation can be swapped for a mock in tests — the same
 * pattern BREVO_CLIENT / CATALOG_SOURCE use, since this build and test
 * environment has no network path to CleanCloud.
 *
 * CleanCloud is the point-of-sale and CRM used by dry cleaners and laundries.
 * It matters to us because an operator who collects and delivers keeps a real
 * postal address as an operational necessity, and captures a birthday at
 * sign-up — the two things a posted birthday card needs and that an
 * email-marketing CRM usually lacks. See ADR 0252.
 */
import type { CrmContactsResult } from "../crm-contacts-result";

export const CLEANCLOUD_CLIENT = Symbol("CLEANCLOUD_CLIENT");

/**
 * One CleanCloud customer, trimmed to what we read.
 *
 * Every field is typed loosely on purpose. CleanCloud's API is documented by
 * example rather than by schema, and its examples show numeric ids and
 * string-wrapped numbers in the same payload. Coercion belongs in the mapper,
 * where a bad value produces an unmappable row rather than a thrown sync.
 */
export interface CleanCloudCustomer {
  customerID?: string | number | null;
  /** One field for the whole name — "Mary Anne Clarke", not first + last. */
  customerName?: string | null;
  /** One free-text field for the whole address, postcode included. */
  customerAddress?: string | null;
  customerEmail?: string | null;
  /** Day and month only. CleanCloud never asks for a birth year. */
  birthdayDay?: string | number | null;
  birthdayMonth?: string | number | null;
}

export interface CleanCloudClient {
  /** Cheap auth check (one short date window). Throws Unauthorized on a bad
   * token so `connect` can say "that token didn't work" without pulling a
   * decade of history first. */
  verifyKey(apiToken: string): Promise<void>;
  /**
   * Every customer created within the history horizon, walked in 31-day
   * windows (CleanCloud's documented maximum range). `truncated` says the
   * walk stopped with windows still unread.
   *
   * `now` is injectable so a test can pin the windows without freezing time.
   */
  fetchCustomers(apiToken: string, now?: Date): Promise<CrmContactsResult<CleanCloudCustomer>>;
}
