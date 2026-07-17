import { Module } from "@nestjs/common";
import { AccountsController } from "./accounts.controller";
import { AccountsService } from "./accounts.service";
import { DashboardService } from "./dashboard.service";
import { EntitlementsModule } from "../entitlements/entitlements.module";

@Module({
  imports: [EntitlementsModule],
  controllers: [AccountsController],
  providers: [AccountsService, DashboardService],
  exports: [AccountsService],
})
export class AccountsModule {}
