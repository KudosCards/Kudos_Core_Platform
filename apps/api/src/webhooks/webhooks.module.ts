import { Module } from "@nestjs/common";
import { WebhooksController } from "./webhooks.controller";
import { WebhooksService } from "./webhooks.service";
import { AuditModule } from "../audit/audit.module";
import { BillingModule } from "../billing/billing.module";
import { BatchOrdersModule } from "../batch-orders/batch-orders.module";
import { WalletModule } from "../wallet/wallet.module";

@Module({
  imports: [AuditModule, BillingModule, BatchOrdersModule, WalletModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
