import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { MessagesController } from "./messages.controller";
import { MessagesService } from "./messages.service";
import { MessagePageEventsService } from "./message-page-events.service";
import { MessagePageEventsRetentionService } from "./message-page-events-retention.service";

@Module({
  // Rate limiting is configured once, globally, in AppModule (see the
  // ThrottlerModule note there); this module's public routes opt in per-route
  // via @UseGuards(ThrottlerGuard) + @Throttle. NotificationsModule provides the
  // inbox producer for reply notifications. The event retention cron runs on the
  // global ScheduleModule registered in AppModule.
  imports: [NotificationsModule],
  controllers: [MessagesController],
  providers: [MessagesService, MessagePageEventsService, MessagePageEventsRetentionService],
  exports: [MessagesService],
})
export class MessagesModule {}
