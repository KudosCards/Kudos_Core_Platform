import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentMembership } from "../auth/current-membership.decorator";
import type { CurrentMembershipContext } from "../auth/types";
import { NotificationsService, type NotificationFeed } from "./notifications.service";

@ApiTags("notifications")
@ApiBearerAuth()
@UseGuards(MembershipGuard)
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** The notification centre feed — computed live from account state. */
  @Get()
  getFeed(@CurrentMembership() membership: CurrentMembershipContext): Promise<NotificationFeed> {
    return this.notifications.getFeed(membership.accountId, membership.role);
  }
}
