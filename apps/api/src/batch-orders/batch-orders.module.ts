import { Module } from "@nestjs/common";
import { BatchOrdersController } from "./batch-orders.controller";
import { BatchOrdersService } from "./batch-orders.service";
import { AuditModule } from "../audit/audit.module";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { BillingModule } from "../billing/billing.module";

@Module({
  imports: [AuditModule, EntitlementsModule, BillingModule],
  controllers: [BatchOrdersController],
  providers: [BatchOrdersService],
  exports: [BatchOrdersService],
})
export class BatchOrdersModule {}
