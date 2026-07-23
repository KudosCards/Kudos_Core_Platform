import { z } from "zod";

/**
 * The notification centre is a **computed** feed — derived live from the
 * account's current state (approvals waiting, occasions coming up, orders
 * awaiting payment, invites pending), not a persisted inbox. So it's always
 * accurate, never stale, and needs no read/unread bookkeeping. See
 * docs/adr/0030-settings-and-notification-centre.md.
 */
export const notificationKindSchema = z.enum([
  "pending_approval",
  "upcoming_occasion",
  "unpaid_order",
  "pending_invite",
]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const notificationItemSchema = z.object({
  /** Stable id so the client can key the list (e.g. "upcoming:<occasionId>"). */
  id: z.string(),
  kind: notificationKindSchema,
  title: z.string(),
  body: z.string(),
  /** Where clicking the item takes the user. */
  href: z.string(),
  /** The event date (for upcoming occasions); null for actions with no date. */
  date: z.coerce.date().nullable(),
});
export type NotificationItem = z.infer<typeof notificationItemSchema>;

export const notificationFeedSchema = z.object({
  items: z.array(notificationItemSchema),
});
export type NotificationFeed = z.infer<typeof notificationFeedSchema>;
