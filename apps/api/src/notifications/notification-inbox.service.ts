import { Injectable, Logger } from "@nestjs/common";
import type { Notification, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { Paginated } from "../common/paginated";
import { parsePage, parsePerPage } from "../common/pagination";

export type InboxNotificationKind =
  | "order_paid"
  | "auto_send"
  | "auto_send_failed"
  | "wallet_low_balance"
  | "auto_top_up_paused"
  | "invite_accepted"
  | "card_returned"
  | "support_reply"
  | "message_reply";

/** The shape of an event to persist. `entityType`/`entityId` make a producer
 * idempotent under retries — Stripe redelivers webhooks, crons can double-fire —
 * so the same real-world event is only ever recorded once per account. */
export interface NotifyPayload {
  kind: InboxNotificationKind;
  title: string;
  body: string;
  href?: string | null;
  entityType?: string;
  entityId?: string;
}

export interface InboxPage extends Paginated<Notification> {
  unreadCount: number;
}

/**
 * The persisted notification inbox. Unlike the computed feed
 * (notifications.service.ts, ADR 0030), these are a per-user history of events
 * that already happened, each carrying its own read/unread. An account-wide
 * event fans out one row per active member so read state is per-user. See
 * docs/adr/0034-notification-inbox.md.
 */
@Injectable()
export class NotificationInboxService {
  private readonly logger = new Logger(NotificationInboxService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record an account-wide event: one notification per active member. Idempotent
   * when `entityId` is given — if the account already has a notification for this
   * (kind, entity), it's a no-op, so a redelivered webhook or a re-run cron can't
   * double-notify. Accepts an optional transaction client so it can enlist in a
   * producer's existing transaction (e.g. the Stripe webhook handler).
   *
   * Returns whether it actually created rows, so a caller can hang a
   * once-per-event side effect off the same dedupe rather than inventing a
   * second one — auto-send emails about a skipped card only on the run that
   * first recorded it, which is what keeps a daily retry from sending a daily
   * email. `notifyAllAdmins` returns the same signal for the same reason.
   */
  async notifyAccount(
    accountId: string,
    payload: NotifyPayload,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<boolean> {
    if (payload.entityId) {
      const existing = await client.notification.findFirst({
        where: { accountId, kind: payload.kind, entityId: payload.entityId },
        select: { id: true },
      });
      if (existing) {
        return false;
      }
    }

    const members = await client.membership.findMany({
      where: { accountId },
      select: { userId: true },
    });
    if (members.length === 0) {
      // Nothing to write to, and — worth being explicit — the same `false` a
      // caller gets for "already told them". The two callers that gate an email
      // on this answer both run for accounts that necessarily have a member, so
      // nothing is silently dropped today; a member-less account reaching here
      // is odd enough to say out loud rather than swallow.
      this.logger.warn(
        `Account ${accountId} has no members — "${payload.kind}" was not recorded anywhere.`,
      );
      return false;
    }

    // `skipDuplicates` against the unique index is what makes this atomic. The
    // read above is the cheap path and cannot settle a race on its own: two
    // producers both pass it, and without this both would insert and both would
    // report the event as new — one email each. Here the loser inserts nothing,
    // counts zero, and stays quiet.
    const { count } = await client.notification.createMany({
      data: members.map((member) => ({
        accountId,
        userId: member.userId,
        kind: payload.kind,
        title: payload.title,
        body: payload.body,
        href: payload.href ?? null,
        entityType: payload.entityType ?? null,
        entityId: payload.entityId ?? null,
      })),
      skipDuplicates: true,
    });
    return count > 0;
  }

  async list(
    accountId: string,
    userId: string,
    page?: string,
    perPage?: string,
  ): Promise<InboxPage> {
    const parsedPage = parsePage(page);
    const parsedPerPage = parsePerPage(perPage, 20);
    const where = { accountId, userId };

    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (parsedPage - 1) * parsedPerPage,
        take: parsedPerPage,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { ...where, readAt: null } }),
    ]);

    return { items, total, page: parsedPage, perPage: parsedPerPage, unreadCount };
  }

  async unreadCount(accountId: string, userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { accountId, userId, readAt: null } });
  }

  /** Mark one notification read. Scoped to (accountId, userId) so a member can
   * only ever touch their own copy; a no-op if it's already read or not theirs. */
  async markRead(accountId: string, userId: string, id: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { id, accountId, userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(accountId: string, userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { accountId, userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
