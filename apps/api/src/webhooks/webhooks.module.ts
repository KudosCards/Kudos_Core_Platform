import { Module } from "@nestjs/common";
import { WebhooksController } from "./webhooks.controller";
import { WebhooksService } from "./webhooks.service";
import { AuditModule } from "../audit/audit.module";
import { BillingModule } from "../billing/billing.module";

@Module({
  imports: [AuditModule, BillingModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
