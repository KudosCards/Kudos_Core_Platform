import { Module } from "@nestjs/common";
import { WebhooksController } from "./webhooks.controller";
import { WebhooksService } from "./webhooks.service";
import { AuditModule } from "../audit/audit.module";
import { BillingModule } from "../billing/billing.module";
import { MessagesModule } from "../messages/messages.module";

@Module({
  imports: [AuditModule, BillingModule, MessagesModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
