import { Injectable } from "@nestjs/common";
import type { MembershipRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type NotificationKind =
  | "pending_approval"
  | "upcoming_occasion"
  | "unpaid_order"
  | "pending_invite";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string;
  date: Date | null;
}

export interface NotificationFeed {
  items: NotificationItem[];
}

/** How far ahead "upcoming" looks, and the most events to surface at once. */
const UPCOMING_WINDOW_DAYS = 21;
const UPCOMING_LIMIT = 6;

/** A short, human date like "Fri 25 Jul". */
function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Builds the notification centre's feed live from the account's current state —
 * no persisted inbox, so it can never be stale or need read/unread bookkeeping.
 * See docs/adr/0030-settings-and-notification-centre.md.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async getFeed(accountId: string, role: MembershipRole): Promise<NotificationFeed> {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const canManageTeam = role === "owner" || role === "admin";

    const [pendingApprovals, upcoming, draftOrders, pendingInvites] = await Promise.all([
      this.prisma.occasion.count({ where: { accountId, status: "pending_approval" } }),
      // Approved/scheduled occasions coming up — the "quick view of upcoming
      // events" the notification centre is for. Excludes pending_approval (its
      // own bucket) and already-sent statuses.
      this.prisma.occasion.findMany({
        where: {
          accountId,
          status: { in: ["scheduled", "approved"] },
          occasionDate: { gte: now, lte: windowEnd },
        },
        orderBy: { occasionDate: "asc" },
        take: UPCOMING_LIMIT,
        include: { recipient: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.batchOrder.count({ where: { accountId, status: "draft" } }),
      // Only surface invite reminders to those who can act on them.
      canManageTeam
        ? this.prisma.invite.count({ where: { accountId, status: "pending" } })
        : Promise.resolve(0),
    ]);

    const items: NotificationItem[] = [];

    if (pendingApprovals > 0) {
      items.push({
        id: "pending-approvals",
        kind: "pending_approval",
        title: `${pendingApprovals} occasion${pendingApprovals === 1 ? "" : "s"} need${
          pendingApprovals === 1 ? "s" : ""
        } approval`,
        body: "Review them so cards go to print in time.",
        href: "/approvals",
        date: null,
      });
    }

    if (draftOrders > 0) {
      items.push({
        id: "unpaid-orders",
        kind: "unpaid_order",
        title: `${draftOrders} order${draftOrders === 1 ? "" : "s"} awaiting payment`,
        body: "Finish checkout to send these cards.",
        href: "/batch-orders",
        date: null,
      });
    }

    if (pendingInvites > 0) {
      items.push({
        id: "pending-invites",
        kind: "pending_invite",
        title: `${pendingInvites} team invite${pendingInvites === 1 ? "" : "s"} awaiting acceptance`,
        body: "Manage who's on your team.",
        href: "/team",
        date: null,
      });
    }

    for (const occasion of upcoming) {
      const name = occasion.recipient
        ? `${occasion.recipient.firstName} ${occasion.recipient.lastName}`
        : (occasion.title ?? "An occasion");
      items.push({
        id: `upcoming:${occasion.id}`,
        kind: "upcoming_occasion",
        title: `${name} — ${formatDate(occasion.occasionDate)}`,
        body:
          occasion.status === "approved"
            ? "Approved and ready to order."
            : "Coming up on your calendar.",
        href: "/calendar",
        date: occasion.occasionDate,
      });
    }

    return { items };
  }
}
