import { Module } from "@nestjs/common";
import { AccountsController } from "./accounts.controller";
import { AccountsService } from "./accounts.service";
import { DashboardService } from "./dashboard.service";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { BillingModule } from "../billing/billing.module";
import { supabaseAdminProvider } from "../supabase/supabase-admin.provider";

@Module({
  // BillingModule provides STRIPE_CLIENT (used to cancel a subscription on
  // account deletion); supabaseAdminProvider is the service-role client that
  // removes the Supabase logins for a deleted account.
  imports: [EntitlementsModule, BillingModule],
  controllers: [AccountsController],
  providers: [AccountsService, DashboardService, supabaseAdminProvider],
  exports: [AccountsService],
})
export class AccountsModule {}
