import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { StandingOrdersController } from "./standing-orders.controller";
import { StandingOrdersService } from "./standing-orders.service";

@Module({
  imports: [AuditModule, EntitlementsModule],
  controllers: [StandingOrdersController],
  providers: [StandingOrdersService],
  // Exported for the phases that will read it: the rule that picks a card and a
  // message (C5) and automatic approval (C6).
  exports: [StandingOrdersService],
})
export class StandingOrdersModule {}
