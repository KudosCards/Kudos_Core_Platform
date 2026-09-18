import { BadGatewayException } from "@nestjs/common";
import type { CleanCloudCustomer } from "./cleancloud-client";

/**
 * Getting customers out of whatever CleanCloud actually sent back.
 *
 * CleanCloud's own documentation says, of `getCustomer`: *"Note that the
 * response is structured differently if you are requesting customers by date
 * range."* It then prints the single-customer shape and not the range one. That
 * is the whole reason this file exists and is tested on its own.
 *
 * The response to that is NOT to guess one envelope and hope. It is to accept
 * every shape the sentence could reasonably mean — a bare array, a named list,
 * or an object keyed by customer id — and, when none of them fits, to fail
 * loudly naming the keys that actually arrived. A wrong guess that returns an
 * empty list is the bad outcome: the sync would report "0 contacts, ok" and
 * nobody would ever learn why. A wrong guess that throws
 * "CleanCloud returned an unrecognised response (keys: …)" is a one-line fix.
 */

/** Keys a list of customers might plausibly be filed under. */
const LIST_KEYS = ["Customers", "customers", "customerList", "data", "results"] as const;

/** Keys CleanCloud might report a failure under, on a 200. An API that answers
 * every request with 200 and an error body is common in this style, and a
 * silently-empty import is exactly what it would produce here. */
const ERROR_KEYS = ["Error", "error", "message", "errorMessage"] as const;

/** How many top-level keys to name in the "unrecognised response" message —
 * enough to fix the parser from, short enough for a status field. */
const KEYS_IN_MESSAGE = 8;

/**
 * The customers in a `getCustomer` response.
 *
 * Throws BadGatewayException when the body is not a shape we can read, or when
 * it carries an error message instead of customers.
 */
export function extractCustomers(body: unknown): CleanCloudCustomer[] {
  if (Array.isArray(body)) {
    return body.filter(isCustomerLike);
  }
  if (body === null || typeof body !== "object") {
    throw new BadGatewayException(
      `CleanCloud returned an unrecognised response (${describe(body)})`,
    );
  }

  const record = body as Record<string, unknown>;

  for (const key of LIST_KEYS) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter(isCustomerLike);
    }
    // A named map keyed by customer id, rather than a named array.
    if (value !== null && typeof value === "object") {
      const nested = Object.values(value as Record<string, unknown>).filter(isCustomerLike);
      if (nested.length > 0) {
        return nested;
      }
    }
  }

  // Only now: a message field is a failure when it comes INSTEAD of customers,
  // not when it comes alongside them. An API that answers `{"message":
  // "success", "Customers": [...]}` is perfectly ordinary, and checking this
  // first would have rejected every page of it.
  for (const key of ERROR_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      throw new BadGatewayException(`CleanCloud request failed — ${value.trim()}`);
    }
  }

  // A bare map keyed by customer id, with no wrapper at all.
  const values = Object.values(record);
  const customers = values.filter(isCustomerLike);
  if (customers.length > 0 && customers.length === values.length) {
    return customers;
  }

  // A single customer returned at the top level — the documented shape for a
  // `customerID` query, and a plausible shape for a range that matched one.
  if (isCustomerLike(record)) {
    return [record];
  }

  // Genuinely empty is a legitimate answer for a 31-day window in which nobody
  // signed up, and must not be mistaken for a shape we failed to read.
  if (values.length === 0) {
    return [];
  }

  throw new BadGatewayException(
    `CleanCloud returned an unrecognised response (keys: ${topKeys(record)})`,
  );
}

/**
 * A value is a customer when it is an object carrying a customer id.
 *
 * `customerID` is the one field every documented example has and the one the
 * ingest cannot do without — it is the external id the whole sync dedupes on.
 * Anything else may be missing; the mapper decides what that costs.
 */
function isCustomerLike(value: unknown): value is CleanCloudCustomer {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const id = (value as Record<string, unknown>).customerID;
  return typeof id === "string" ? id.trim().length > 0 : typeof id === "number";
}

function topKeys(record: Record<string, unknown>): string {
  const keys = Object.keys(record);
  const shown = keys.slice(0, KEYS_IN_MESSAGE).join(", ");
  return keys.length > KEYS_IN_MESSAGE ? `${shown}, …` : shown;
}

function describe(body: unknown): string {
  return body === null ? "null" : `a ${typeof body}`;
}
