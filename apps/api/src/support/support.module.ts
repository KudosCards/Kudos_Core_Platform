import { Module } from "@nestjs/common";
import { SupportService } from "./support.service";
import { SupportController } from "./support.controller";
import { SupportOpsController } from "./support-ops.controller";
import { AuditModule } from "../audit/audit.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { EmailModule } from "../email/email.module";

@Module({
  imports: [AuditModule, NotificationsModule, EmailModule],
  controllers: [SupportController, SupportOpsController],
  providers: [SupportService],
})
export class SupportModule {}
