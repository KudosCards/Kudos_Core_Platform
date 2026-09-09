import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { PlatformNotificationsModule } from "../platform-notifications/platform-notifications.module";
import { SegmentsService } from "./segments.service";
import { SegmentsController } from "./segments.controller";

@Module({
  imports: [AuditModule, EntitlementsModule, PlatformNotificationsModule],
  controllers: [SegmentsController],
  providers: [SegmentsService],
})
export class SegmentsModule {}
