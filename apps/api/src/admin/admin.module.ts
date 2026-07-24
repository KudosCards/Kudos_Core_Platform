import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AdminCustomerService } from "./admin-customer.service";
import { AdminTeamController } from "./admin-team.controller";
import { AdminTeamService } from "./admin-team.service";

/** The Kudos super-admin surface (platform-wide orders, subscribers, KPIs, the
 * in-app seat-price provisioning action, and operator identity + team
 * management). PlatformAdminGuard is available app-wide via the global
 * AuthModule. See docs/adr/0040-admin-auth.md. */
@Module({
  imports: [BillingModule],
  controllers: [AdminController, AdminTeamController],
  providers: [AdminService, AdminCustomerService, AdminTeamService],
})
export class AdminModule {}
