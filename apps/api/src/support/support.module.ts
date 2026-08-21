import { Module } from "@nestjs/common";
import { SupportService } from "./support.service";
import { SupportController } from "./support.controller";
import { SupportOpsController } from "./support-ops.controller";
import { AuditModule } from "../audit/audit.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { EmailModule } from "../email/email.module";
import { StorageModule } from "../storage/storage.module";

@Module({
  // StorageModule: support attachments live in a private bucket, so reads mint
  // a signed URL per request instead of serving a stored one.
  imports: [AuditModule, NotificationsModule, EmailModule, StorageModule],
  controllers: [SupportController, SupportOpsController],
  providers: [SupportService],
})
export class SupportModule {}
