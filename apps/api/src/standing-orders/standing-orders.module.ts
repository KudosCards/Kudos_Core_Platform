import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { OpsActivityModule } from "../ops-activity/ops-activity.module";
import { StandingOrdersController } from "./standing-orders.controller";
import { StandingOrderApprovalController } from "./standing-order-approval.controller";
import { StandingOrdersService } from "./standing-orders.service";
import { StandingOrderApprovalService } from "./standing-order-approval.service";
import { MessageDraftingService } from "./message-drafting.service";
import { messageDrafterProvider } from "./message-drafter.provider";

@Module({
  imports: [AuditModule, EntitlementsModule, OpsActivityModule],
  controllers: [StandingOrdersController, StandingOrderApprovalController],
  providers: [
    StandingOrdersService,
    StandingOrderApprovalService,
    MessageDraftingService,
    messageDrafterProvider,
  ],
  // Exported for the phase that will read them: the rule that picks a card and
  // a message by what suits the recipient (C5).
  exports: [StandingOrdersService, StandingOrderApprovalService],
})
export class StandingOrdersModule {}
