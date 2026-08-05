import { Module } from "@nestjs/common";
import { PlatformNotificationsController } from "./platform-notifications.controller";
import { PlatformNotificationService } from "./platform-notification.service";

/** The Kudos HQ ops notification centre (ADR 0116). Exports the service so
 * producers (e.g. the send-by-5 dispatch reminder) can write operator alerts.
 * PlatformAdminGuard is available app-wide via the global AuthModule. */
@Module({
  controllers: [PlatformNotificationsController],
  providers: [PlatformNotificationService],
  exports: [PlatformNotificationService],
})
export class PlatformNotificationsModule {}
