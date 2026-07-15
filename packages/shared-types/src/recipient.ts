import { z } from "zod";
import { recipientStatusSchema } from "./enums";

const ukPostcodeRegex = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;

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
  address: addressSchema.nullable(),
  tags: z.array(z.string()).default([]),
  status: recipientStatusSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Recipient = z.infer<typeof recipientSchema>;

export const createRecipientInputSchema = recipientSchema.pick({
  firstName: true,
  lastName: true,
  dateOfBirth: true,
  email: true,
  address: true,
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
