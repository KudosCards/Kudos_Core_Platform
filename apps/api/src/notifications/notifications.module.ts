import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";
import { NotificationInboxService } from "./notification-inbox.service";

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationInboxService],
  // Exported so event producers (Stripe webhook, auto-send cron, team accept)
  // can record inbox notifications. See docs/adr/0034-notification-inbox.md.
  exports: [NotificationInboxService],
})
export class NotificationsModule {}
