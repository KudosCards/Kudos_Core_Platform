import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { BillingModule } from "../billing/billing.module";
import { BatchOrdersModule } from "../batch-orders/batch-orders.module";
import { OpsActivityModule } from "../ops-activity/ops-activity.module";
import { WalletController } from "./wallet.controller";
import { WalletService } from "./wallet.service";

@Module({
  imports: [AuditModule, BillingModule, BatchOrdersModule, OpsActivityModule],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
