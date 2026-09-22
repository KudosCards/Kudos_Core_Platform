import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { BillingModule } from "../billing/billing.module";
import { BatchOrdersModule } from "../batch-orders/batch-orders.module";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { OpsActivityModule } from "../ops-activity/ops-activity.module";
import { WalletController } from "./wallet.controller";
import { WalletWatchController } from "./wallet-watch.controller";
import { WalletService } from "./wallet.service";
import { WalletWatchService } from "./wallet-watch.service";

@Module({
  imports: [
    AuditModule,
    BillingModule,
    BatchOrdersModule,
    OpsActivityModule,
    // The wallet watch prices what the account has committed to and tells them
    // when the balance will not reach it (ADR 0255).
    EntitlementsModule,
    NotificationsModule,
  ],
  controllers: [WalletController, WalletWatchController],
  providers: [WalletService, WalletWatchService],
  exports: [WalletService, WalletWatchService],
})
export class WalletModule {}
