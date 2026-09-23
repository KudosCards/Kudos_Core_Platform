import { z } from "zod";
import { recipientStatusSchema } from "./enums";

/**
 * Single source of truth for UK postcode shape — apps/api imports this
 * directly rather than keeping its own copy in sync by hand.
 *
 * Written as a pattern string rather than a literal so the anchored validator
 * and the unanchored finder below are provably the same shape. They were going
 * to be two literals; two literals drift.
 */
function ukPostcodePattern(gap: string): string {
  return `[A-Z]{1,2}\\d[A-Z\\d]?${gap}\\d[A-Z]{2}`;
}

/** Validates a postcode FIELD: the whole string must be a postcode. At most one
 * space in the middle, because a field is something someone typed into a box
 * meant only for this. */
export const ukPostcodeRegex = new RegExp(`^${ukPostcodePattern("\\s?")}$`, "i");

/**
 * Finds a postcode INSIDE free text — the shape some CRMs hand us an address
 * in (CleanCloud stores one `customerAddress` string, not structured fields).
 *
 * Returns the LAST match, because a UK address ends with its postcode: "12
 * Sw1a Court, London SW1A 1AA" must yield the real one, not the street name.
 * The boundaries stop a run of letters and digits inside a longer token
 * ("ORDER-SW1A1AAX") from reading as a postcode.
 *
 * A fresh RegExp per call, deliberately: a shared global regex carries
 * `lastIndex` between calls, so the second caller gets a different answer to
 * the first from the same input.
 */
export function findUkPostcode(
  text: string,
): { postcode: string; start: number; end: number } | null {
  // The one deliberate difference from the validator above: any run of spaces,
  // not at most one. This reads a whole address somebody typed in free text,
  // where "N1  9GU" is a typo to cope with rather than a value to reject —
  // and where rejecting it means posting a card with no postcode on it.
  const pattern = new RegExp(`(^|[^A-Z\\d])(${ukPostcodePattern("\\s*")})($|[^A-Z\\d])`, "gi");
  let found: { postcode: string; start: number; end: number } | null = null;
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    const lead = match[1] ?? "";
    const postcode = match[2] ?? "";
    const start = match.index + lead.length;
    found = { postcode, start, end: start + postcode.length };
    // Resume just past the postcode, not past the delimiter this match also
    // consumed — otherwise that character cannot open the next candidate.
    pattern.lastIndex = found.end;
  }
  return found;
}

/** Matches the CSV import contract's dd/mm/yyyy date format. Captures
 * day/month/year so apps/api's parser can reuse this directly instead of
 * keeping a second, structurally-identical regex in sync by hand. */
export const ukDateRegex = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/**
 * A standalone nested address block. NOT currently used by orderRecipientSchema
 * (see order.ts) — OrderRecipient's real shipping address is flat columns,
 * same as Recipient's own address fields below, not this nested shape. Kept
 * as a general-purpose type for any future one-off address input that
 * genuinely wants a nested object; not wired to anything today.
 */
export const addressSchema = z.object({
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(120),
  postcode: z.string().regex(ukPostcodeRegex, "Must be a valid UK postcode"),
  country: z.string().default("GB"),
});
export type Address = z.infer<typeof addressSchema>;

export const recipientSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  /** Nullable: not every occasion (e.g. a "thank you" recipient) needs a DOB. */
  dateOfBirth: z.coerce.date().nullable(),
  /** False when the source gave a day and month but no year (CleanCloud
   * captures exactly that). The year in `dateOfBirth` is then a placeholder
   * and must never be shown — see `formatBirthDate`. */
  birthYearKnown: z.boolean().default(true),
  email: z.string().email().nullable(),
  addressLine1: z.string().max(200).nullable(),
  addressLine2: z.string().max(200).nullable(),
  addressCity: z.string().max(120).nullable(),
  addressPostcode: z.string().regex(ukPostcodeRegex, "Must be a valid UK postcode").nullable(),
  addressCountry: z.string().nullable(),
  tags: z.array(z.string()).default([]),
  /** Arbitrary key→value fields usable as {key} merge tokens on a card. */
  customFields: z.record(z.string()).nullable(),
  status: recipientStatusSchema,
  /** True when a card to this contact was Returned to Sender and the address
   * hasn't been re-verified: automatic sends are paused and checkout warns.
   * See docs/adr/0039-returned-to-sender.md. */
  addressVerificationRequired: z.boolean(),
  /** Where the recipient came from: "manual", "csv", "api", or a CRM id. */
  source: z.string(),
  /** Stable id of the contact in its source system; null for manual/CSV. */
  externalId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Recipient = z.infer<typeof recipientSchema>;

export const createRecipientInputSchema = recipientSchema
  .pick({
    firstName: true,
    lastName: true,
    dateOfBirth: true,
    email: true,
    addressLine1: true,
    addressLine2: true,
    addressCity: true,
    addressPostcode: true,
    tags: true,
    customFields: true,
  })
  .partial({
    dateOfBirth: true,
    email: true,
    addressLine1: true,
    addressLine2: true,
    addressCity: true,
    addressPostcode: true,
    tags: true,
    customFields: true,
  });
export type CreateRecipientInput = z.infer<typeof createRecipientInputSchema>;

/** Matches the current CSV import contract: dd/mm/yyyy, dedupe on name + postcode + DOB. */
export const importRecipientRowSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: z.string().regex(ukDateRegex, "Expected dd/mm/yyyy"),
  postcode: z.string().regex(ukPostcodeRegex).optional(),
  email: z.string().email().optional(),
});
export type ImportRecipientRow = z.infer<typeof importRecipientRowSchema>;

/**
 * How many of a set of contacts a birthday card can actually reach.
 *
 * A card needs a date of birth to know when and a postal address to know
 * where, and both are optional everywhere they come from. Asked in two places
 * now — after a CRM import (ADR 0214), and by click and forget about the
 * audience somebody is handing over (ADR 0264) — which is why it is one shape
 * rather than two counts that could disagree.
 */
export const contactReadinessSchema = z.object({
  total: z.number().int().nonnegative(),
  withDateOfBirth: z.number().int().nonnegative(),
  /** Enough of an address to post to — the same definition the contacts list
   *  and the dashboard's "needs address" count use. */
  withPostalAddress: z.number().int().nonnegative(),
  /** Both — the only ones a birthday card can reach. */
  sendable: z.number().int().nonnegative(),
});
export type ContactReadiness = z.infer<typeof contactReadinessSchema>;
