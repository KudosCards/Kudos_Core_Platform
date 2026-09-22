import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { StandingOrdersController } from "./standing-orders.controller";
import { StandingOrderApprovalController } from "./standing-order-approval.controller";
import { StandingOrdersService } from "./standing-orders.service";
import { StandingOrderApprovalService } from "./standing-order-approval.service";

@Module({
  imports: [AuditModule, EntitlementsModule],
  controllers: [StandingOrdersController, StandingOrderApprovalController],
  providers: [StandingOrdersService, StandingOrderApprovalService],
  // Exported for the phase that will read them: the rule that picks a card and
  // a message by what suits the recipient (C5).
  exports: [StandingOrdersService, StandingOrderApprovalService],
})
export class StandingOrdersModule {}
