import { z } from "zod";

/** One previewed member, for the small "who's on this" line on a list card. */
export const recipientListMemberSchema = z.object({
  id: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
});
export type RecipientListMember = z.infer<typeof recipientListMemberSchema>;

/**
 * A named grouping of recipients a subscriber curates by hand — e.g. a
 * teacher's "Year 4 class". Purely organisational (filter + bulk personalise).
 * See docs/adr/0016-recipient-events-and-lists.md.
 */
export const recipientListSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  memberCount: z.number().int().nonnegative(),
  /** A bounded preview of who is on the list — never the whole membership.
   * The full set is read through `GET /recipients?listId=`, which is paginated
   * and carries the same search/sort/status filters as the contacts table. */
  sample: z.array(recipientListMemberSchema),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type RecipientListSummary = z.infer<typeof recipientListSummarySchema>;

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

/** Matches RemoveListMembersDto — the bulk counterpart of add. */
export const removeListMembersInputSchema = addListMembersInputSchema;
export type RemoveListMembersInput = z.infer<typeof removeListMembersInputSchema>;
