import { Module } from "@nestjs/common";
import { FulfillmentController } from "./fulfillment.controller";
import { FulfillmentService } from "./fulfillment.service";
import { DispatchReminderService } from "./dispatch-reminder.service";
import { AuditModule } from "../audit/audit.module";
import { ShippingModule } from "../shipping/shipping.module";
import { PlatformNotificationsModule } from "../platform-notifications/platform-notifications.module";

@Module({
  imports: [AuditModule, ShippingModule, PlatformNotificationsModule],
  controllers: [FulfillmentController],
  providers: [FulfillmentService, DispatchReminderService],
})
export class FulfillmentModule {}
