import { Module } from "@nestjs/common";
import { SupabaseAdminModule } from "../supabase/supabase-admin.module";
import { PlatformNotificationsModule } from "../platform-notifications/platform-notifications.module";
import { WalletModule } from "./wallet.module";
import { WalletCampaignsService } from "./wallet-campaigns.service";

/**
 * Delivery for wallet campaigns, kept out of `WalletModule` on purpose.
 *
 * `WalletModule` owns the ledger and is imported widely; this needs Supabase
 * and the operator inbox, which the ledger has no business depending on. A
 * separate module also keeps the signup path's import of the eager credit from
 * pulling the whole wallet graph into `AccountsModule`.
 */
@Module({
  imports: [WalletModule, SupabaseAdminModule, PlatformNotificationsModule],
  providers: [WalletCampaignsService],
  exports: [WalletCampaignsService],
})
export class WalletCampaignsModule {}
