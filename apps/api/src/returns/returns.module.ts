import { Module } from "@nestjs/common";
import { ReturnsService } from "./returns.service";
import { ReturnsController } from "./returns.controller";
import { ReturnsOpsController } from "./returns-ops.controller";
import { AuditModule } from "../audit/audit.module";
import { BatchOrdersModule } from "../batch-orders/batch-orders.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { EmailModule } from "../email/email.module";

@Module({
  imports: [AuditModule, BatchOrdersModule, NotificationsModule, EmailModule],
  controllers: [ReturnsController, ReturnsOpsController],
  providers: [ReturnsService],
})
export class ReturnsModule {}
