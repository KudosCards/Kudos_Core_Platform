import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformAdminGuard } from "../auth/platform-admin.guard";
import { CurrentPlatformAdmin } from "../auth/current-platform-admin.decorator";
import type { PlatformAdminContext } from "../auth/types";
import {
  PlatformNotificationService,
  type PlatformInboxPage,
} from "./platform-notification.service";

/**
 * The Kudos HQ ops notification centre. Every route is gated by PlatformAdminGuard
 * and scoped to the calling operator's own notifications. See ADR 0116.
 */
@ApiTags("platform-notifications")
@ApiBearerAuth()
@UseGuards(PlatformAdminGuard)
@Controller("admin/notifications")
export class PlatformNotificationsController {
  constructor(private readonly notifications: PlatformNotificationService) {}

  /** The operator's persisted inbox — newest first, with read/unread. */
  @Get()
  list(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Query("page") page?: string,
    @Query("perPage") perPage?: string,
  ): Promise<PlatformInboxPage> {
    return this.notifications.list(admin.userId, page, perPage);
  }

  /** Just the unread count — cheap enough to poll for the header badge. */
  @Get("unread-count")
  async unreadCount(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
  ): Promise<{ unreadCount: number }> {
    const unreadCount = await this.notifications.unreadCount(admin.userId);
    return { unreadCount };
  }

  @Post("read-all")
  async markAllRead(@CurrentPlatformAdmin() admin: PlatformAdminContext): Promise<{ ok: true }> {
    await this.notifications.markAllRead(admin.userId);
    return { ok: true };
  }

  @Post(":id/read")
  async markRead(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param("id") id: string,
  ): Promise<{ ok: true }> {
    await this.notifications.markRead(admin.userId, id);
    return { ok: true };
  }
}
