import { z } from "zod";
import { recipientStatusSchema } from "./enums";

const ukPostcodeRegex = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;

/**
 * A standalone shipping address block — used for one-off addresses (e.g. an
 * order line's shipping destination), not for the Recipient entity itself,
 * which stores its address as flat columns (see recipientSchema below) to
 * match apps/api/prisma/schema.prisma.
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
  dateOfBirth: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, "Expected dd/mm/yyyy"),
  postcode: z.string().regex(ukPostcodeRegex).optional(),
  email: z.string().email().optional(),
});
export type ImportRecipientRow = z.infer<typeof importRecipientRowSchema>;
