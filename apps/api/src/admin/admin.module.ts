import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

/** The Kudos super-admin surface (platform-wide orders, subscribers, KPIs).
 * PlatformAdminGuard is available app-wide via the global AuthModule. */
@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
