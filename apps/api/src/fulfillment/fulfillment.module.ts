import { Module } from "@nestjs/common";
import { FulfillmentController } from "./fulfillment.controller";
import { FulfillmentService } from "./fulfillment.service";
import { DispatchReminderService } from "./dispatch-reminder.service";
import { DeliveryPollService } from "./delivery-poll.service";
import { ArrivalNotificationService } from "./arrival-notification.service";
import { PrintRunPdfService } from "./print-run-pdf.service";
import { PrintRunArtworkService } from "./print-run-artwork.service";
import { AuditModule } from "../audit/audit.module";
import { ShippingModule } from "../shipping/shipping.module";
import { PlatformNotificationsModule } from "../platform-notifications/platform-notifications.module";
import { DispatchModule } from "../dispatch/dispatch.module";

@Module({
  imports: [AuditModule, ShippingModule, PlatformNotificationsModule, DispatchModule],
  controllers: [FulfillmentController],
  providers: [
    FulfillmentService,
    DispatchReminderService,
    DeliveryPollService,
    ArrivalNotificationService,
    PrintRunPdfService,
    PrintRunArtworkService,
  ],
})
export class FulfillmentModule {}
