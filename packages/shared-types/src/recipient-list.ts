import { z } from "zod";

/**
 * A named grouping of recipients a subscriber curates by hand — e.g. a
 * teacher's "Year 4 class". Purely organisational (filter + bulk personalise).
 * See docs/adr/0016-recipient-events-and-lists.md.
 */
export const recipientListSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  memberCount: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type RecipientListSummary = z.infer<typeof recipientListSummarySchema>;

/** A list plus its members' display names — the detail-view shape. */
export const recipientListWithMembersSchema = recipientListSummarySchema.extend({
  members: z.array(
    z.object({
      id: z.string().uuid(),
      firstName: z.string(),
      lastName: z.string(),
    }),
  ),
});
export type RecipientListWithMembers = z.infer<typeof recipientListWithMembersSchema>;

/** Matches CreateRecipientListDto / UpdateRecipientListDto. */
export const recipientListNameInputSchema = z.object({
  name: z.string().min(1).max(120),
});
export type RecipientListNameInput = z.infer<typeof recipientListNameInputSchema>;

/** Matches AddListMembersDto. */
export const addListMembersInputSchema = z.object({
  recipientIds: z.array(z.string().uuid()).min(1).max(1000),
});
export type AddListMembersInput = z.infer<typeof addListMembersInputSchema>;
