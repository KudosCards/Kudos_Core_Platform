import { Module } from "@nestjs/common";
import { PlatformNotificationsModule } from "../platform-notifications/platform-notifications.module";
import { OpsActivityService } from "./ops-activity.service";
import { OpsDigestService } from "./ops-digest.service";

/**
 * What Kudos HQ gets told about: live operator alerts for the events worth
 * knowing immediately (OpsActivityService) and the morning digest of the day
 * before (OpsDigestService).
 *
 * PrismaModule and EmailModule are global, so PlatformNotifications is the one
 * thing to wire. The digest is exported too, for the ops "send it now" trigger
 * on the admin dashboard — waiting until tomorrow morning to find out whether
 * the email renders is not a debugging strategy.
 */
@Module({
  imports: [PlatformNotificationsModule],
  providers: [OpsActivityService, OpsDigestService],
  exports: [OpsActivityService, OpsDigestService],
})
export class OpsActivityModule {}
