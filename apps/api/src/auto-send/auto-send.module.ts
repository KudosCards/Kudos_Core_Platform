import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { WalletModule } from "../wallet/wallet.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { OpsActivityModule } from "../ops-activity/ops-activity.module";
import { AutoSendController } from "./auto-send.controller";
import { AutoSendService } from "./auto-send.service";

@Module({
  imports: [AuditModule, EntitlementsModule, WalletModule, NotificationsModule, OpsActivityModule],
  controllers: [AutoSendController],
  providers: [AutoSendService],
  exports: [AutoSendService],
})
export class AutoSendModule {}
