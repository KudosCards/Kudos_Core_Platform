import { z } from "zod";
import { keyDateTypeSchema } from "./enums";

/**
 * A recipient's recurring "key date" — a renewal or anniversary anchored on a
 * month/day, from which the scheduler materialises a dated occasion each year
 * (exactly like a birthday from the date of birth). One per type per recipient.
 * See docs/adr/0104-recurring-key-dates.md.
 */
export const recipientKeyDateSchema = z.object({
  id: z.string().uuid(),
  recipientId: z.string().uuid(),
  type: keyDateTypeSchema,
  /** The anchor date; the occasion recurs annually on this month/day. */
  date: z.coerce.date(),
  /** Optional human label shown on the occasion/calendar (e.g. "Membership renewal"). */
  label: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type RecipientKeyDate = z.infer<typeof recipientKeyDateSchema>;

/** Set (create-or-update) a recipient's key date of a given type. */
export const upsertKeyDateInputSchema = z.object({
  /** yyyy-mm-dd; only the month/day drive the annual recurrence. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date"),
  label: z.string().trim().max(80).optional(),
});
export type UpsertKeyDateInput = z.infer<typeof upsertKeyDateInputSchema>;
