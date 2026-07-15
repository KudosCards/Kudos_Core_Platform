import { z } from "zod";
import { occasionSourceSchema, occasionStatusSchema, occasionTypeSchema } from "./enums";

export const occasionSchema = z
  .object({
    id: z.string().uuid(),
    accountId: z.string().uuid(),
    /** Null for one_off_campaign occasions (e.g. an org-wide "Student of the Month" send). */
    recipientId: z.string().uuid().nullable(),
    type: occasionTypeSchema,
    source: occasionSourceSchema,
    /** The date the occasion itself falls on (e.g. the birthday), not the dispatch date. */
    occasionDate: z.coerce.date(),
    /** Computed: occasionDate minus the postage lead time for the chosen dispatch option. */
    dispatchDate: z.coerce.date().nullable(),
    status: occasionStatusSchema,
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .refine((o) => o.source !== "recurring_per_recipient" || o.recipientId !== null, {
    message: "recurring_per_recipient occasions must have a recipientId",
    path: ["recipientId"],
  });
export type Occasion = z.infer<typeof occasionSchema>;

export const createOccasionInputSchema = z.object({
  recipientId: z.string().uuid().nullable(),
  type: occasionTypeSchema,
  source: occasionSourceSchema,
  occasionDate: z.coerce.date(),
});
export type CreateOccasionInput = z.infer<typeof createOccasionInputSchema>;
