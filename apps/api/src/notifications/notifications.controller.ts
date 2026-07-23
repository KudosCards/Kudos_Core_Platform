import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentMembership } from "../auth/current-membership.decorator";
import type { CurrentMembershipContext } from "../auth/types";
import { NotificationsService, type NotificationFeed } from "./notifications.service";
import { NotificationInboxService, type InboxPage } from "./notification-inbox.service";

@ApiTags("notifications")
@ApiBearerAuth()
@UseGuards(MembershipGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly inbox: NotificationInboxService,
  ) {}

  /** The notification centre feed — live "action needed" items, computed from
   * current account state (ADR 0030). No read/unread. */
  @Get()
  getFeed(@CurrentMembership() membership: CurrentMembershipContext): Promise<NotificationFeed> {
    return this.notifications.getFeed(membership.accountId, membership.role);
  }

  /** The persisted inbox — a per-user history of things that happened, with
   * read/unread. Paginated, newest first. */
  @Get("inbox")
  getInbox(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Query("page") page?: string,
    @Query("perPage") perPage?: string,
  ): Promise<InboxPage> {
    return this.inbox.list(membership.accountId, membership.userId, page, perPage);
  }

  /** Just the unread count — cheap enough to poll for the header badge. */
  @Get("inbox/unread-count")
  async getUnreadCount(
    @CurrentMembership() membership: CurrentMembershipContext,
  ): Promise<{ unreadCount: number }> {
    const unreadCount = await this.inbox.unreadCount(membership.accountId, membership.userId);
    return { unreadCount };
  }

  @Post("inbox/read-all")
  async markAllRead(
    @CurrentMembership() membership: CurrentMembershipContext,
  ): Promise<{ ok: true }> {
    await this.inbox.markAllRead(membership.accountId, membership.userId);
    return { ok: true };
  }

  @Post("inbox/:id/read")
  async markRead(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Param("id") id: string,
  ): Promise<{ ok: true }> {
    await this.inbox.markRead(membership.accountId, membership.userId, id);
    return { ok: true };
  }
}
