import { Module } from "@nestjs/common";
import { SubscriptionsController } from "./subscriptions.controller";
import { SubscriptionsService } from "./subscriptions.service";
import { AuditModule } from "../audit/audit.module";
import { BillingModule } from "../billing/billing.module";

@Module({
  imports: [AuditModule, BillingModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
})
export class SubscriptionsModule {}
