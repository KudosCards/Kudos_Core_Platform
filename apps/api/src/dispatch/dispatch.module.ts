import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { DispatchConfigService } from "./dispatch-config.service";

/**
 * Loads admin-configured seasonal dispatch rules into the shared engine on boot
 * (and keeps them fresh). Global so the config is applied process-wide the
 * moment the app starts, before any dispatch date is computed.
 */
@Module({
  imports: [BillingModule],
  providers: [DispatchConfigService],
  exports: [DispatchConfigService],
})
export class DispatchModule {}
