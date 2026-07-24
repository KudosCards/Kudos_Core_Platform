import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

/** The Kudos super-admin surface (platform-wide orders, subscribers, KPIs, and
 * the in-app seat-price provisioning action). PlatformAdminGuard is available
 * app-wide via the global AuthModule. */
@Module({
  imports: [BillingModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
