import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { DispatchModule } from "../dispatch/dispatch.module";
import { OpsActivityModule } from "../ops-activity/ops-activity.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AdminCustomerService } from "./admin-customer.service";
import { AdminTeamController } from "./admin-team.controller";
import { AdminTeamService } from "./admin-team.service";
import { CardSizeConfigService } from "./card-size-config.service";
import { BatchOrdersModule } from "../batch-orders/batch-orders.module";
import { WalletModule } from "../wallet/wallet.module";

/** The Kudos super-admin surface (platform-wide orders, subscribers, KPIs, the
 * in-app seat-price provisioning action, and operator identity + team
 * management). PlatformAdminGuard is available app-wide via the global
 * AuthModule. See docs/adr/0040-admin-auth.md. */
@Module({
  // BatchOrdersModule: the occasion re-date repair is ops-triggered but the
  // scheduling logic belongs with orders, not duplicated here.
  imports: [BillingModule, DispatchModule, OpsActivityModule, BatchOrdersModule, WalletModule],
  controllers: [AdminController, AdminTeamController],
  providers: [AdminService, AdminCustomerService, AdminTeamService, CardSizeConfigService],
})
export class AdminModule {}
