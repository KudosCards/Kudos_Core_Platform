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

/**
 * The persisted notification **inbox** — a per-user history of things that have
 * already happened in the account (an order paid, an auto-send fired, a
 * colleague joined), each with its own read/unread state. This is distinct
 * from the computed feed above (live "action needed" items, no read state):
 * the two are shown together but stored differently. An account-wide event
 * fans out one row per member so read state is per-user. See
 * docs/adr/0034-notification-inbox.md.
 */
export const inboxNotificationKindSchema = z.enum([
  "order_paid",
  "auto_send",
  "invite_accepted",
]);
export type InboxNotificationKind = z.infer<typeof inboxNotificationKindSchema>;

export const inboxNotificationSchema = z.object({
  id: z.string().uuid(),
  kind: inboxNotificationKindSchema,
  title: z.string(),
  body: z.string(),
  /** In-app link the item points to; null for informational-only items. */
  href: z.string().nullable(),
  /** When the current user read it; null while unread. */
  readAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});
export type InboxNotification = z.infer<typeof inboxNotificationSchema>;

export const inboxPageSchema = z.object({
  items: z.array(inboxNotificationSchema),
  /** Unread count across the whole inbox (not just this page) — drives the badge. */
  unreadCount: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  perPage: z.number().int().positive(),
});
export type InboxPage = z.infer<typeof inboxPageSchema>;

export const unreadCountSchema = z.object({
  unreadCount: z.number().int().nonnegative(),
});
export type UnreadCount = z.infer<typeof unreadCountSchema>;
