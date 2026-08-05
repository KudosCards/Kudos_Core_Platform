import { Injectable } from "@nestjs/common";
import type { PlatformNotification, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { Paginated } from "../common/paginated";
import { parsePage, parsePerPage } from "../common/pagination";

/** An operator alert to persist. `entityType`/`entityId` make a producer
 * idempotent under retries — a re-fired cron records the same event once. */
export interface PlatformNotifyPayload {
  kind: string;
  title: string;
  body: string;
  href?: string | null;
  entityType?: string;
  entityId?: string;
}

export interface PlatformInboxPage extends Paginated<PlatformNotification> {
  unreadCount: number;
}

/**
 * The Kudos HQ ops notification centre — the platform-admin equivalent of the
 * account NotificationInboxService (ADR 0034). A platform-wide event fans out one
 * row per operator, so read state is per-user. See ADR 0116.
 */
@Injectable()
export class PlatformNotificationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a platform-wide event: one notification per operator. Idempotent when
   * `entityId` is given — if any operator already has a notification for this
   * (kind, entity), it's a no-op, so a re-run cron can't double-notify. Accepts a
   * transaction client so it can enlist in a producer's existing transaction.
   */
  async notifyAllAdmins(
    payload: PlatformNotifyPayload,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    if (payload.entityId) {
      const existing = await client.platformNotification.findFirst({
        where: { kind: payload.kind, entityId: payload.entityId },
        select: { id: true },
      });
      if (existing) {
        return;
      }
    }

    const admins = await client.platformAdmin.findMany({ select: { userId: true } });
    if (admins.length === 0) {
      return;
    }

    await client.platformNotification.createMany({
      data: admins.map((admin) => ({
        userId: admin.userId,
        kind: payload.kind,
        title: payload.title,
        body: payload.body,
        href: payload.href ?? null,
        entityType: payload.entityType ?? null,
        entityId: payload.entityId ?? null,
      })),
    });
  }

  async list(userId: string, page?: string, perPage?: string): Promise<PlatformInboxPage> {
    const parsedPage = parsePage(page);
    const parsedPerPage = parsePerPage(perPage, 20);
    const where = { userId };

    const [items, total, unreadCount] = await Promise.all([
      this.prisma.platformNotification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (parsedPage - 1) * parsedPerPage,
        take: parsedPerPage,
      }),
      this.prisma.platformNotification.count({ where }),
      this.prisma.platformNotification.count({ where: { ...where, readAt: null } }),
    ]);

    return { items, total, page: parsedPage, perPage: parsedPerPage, unreadCount };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.platformNotification.count({ where: { userId, readAt: null } });
  }

  /** Mark one notification read. Scoped to the operator so they can only touch
   * their own copy; a no-op if already read or not theirs. */
  async markRead(userId: string, id: string): Promise<void> {
    await this.prisma.platformNotification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.platformNotification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
