import { z } from "zod";
import { recipientStatusSchema } from "./enums";

/** Single source of truth for UK postcode shape — apps/api imports this
 * directly rather than keeping its own copy in sync by hand. */
export const ukPostcodeRegex = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;

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
  email: z.string().email().nullable(),
  addressLine1: z.string().max(200).nullable(),
  addressLine2: z.string().max(200).nullable(),
  addressCity: z.string().max(120).nullable(),
  addressPostcode: z
    .string()
    .regex(ukPostcodeRegex, "Must be a valid UK postcode")
    .nullable(),
  addressCountry: z.string().nullable(),
  tags: z.array(z.string()).default([]),
  status: recipientStatusSchema,
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
  })
  .partial({
    dateOfBirth: true,
    email: true,
    addressLine1: true,
    addressLine2: true,
    addressCity: true,
    addressPostcode: true,
    tags: true,
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
