import { Module } from "@nestjs/common";
import { RecipientsController } from "./recipients.controller";
import { RecipientsService } from "./recipients.service";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [EntitlementsModule, AuditModule],
  controllers: [RecipientsController],
  providers: [RecipientsService],
  exports: [RecipientsService],
})
export class RecipientsModule {}
