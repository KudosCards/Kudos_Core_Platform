import { Module } from "@nestjs/common";
import { SubscriptionsController } from "./subscriptions.controller";
import { SubscriptionsService } from "./subscriptions.service";
import { AuditModule } from "../audit/audit.module";
import { BillingModule } from "../billing/billing.module";
import { EntitlementsModule } from "../entitlements/entitlements.module";

@Module({
  imports: [AuditModule, BillingModule, EntitlementsModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  // Exported so the team view can read the shared seat summary.
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
