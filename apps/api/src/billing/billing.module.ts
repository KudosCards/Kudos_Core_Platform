import { Module } from "@nestjs/common";
import { STRIPE_CLIENT, stripeClientProvider } from "./stripe-client.provider";
import { PlatformSettingsService } from "./platform-settings.service";
import { SeatBillingService } from "./seat-billing.service";

@Module({
  providers: [stripeClientProvider, PlatformSettingsService, SeatBillingService],
  // SeatBillingService (and the raw client) are consumed by subscriptions,
  // webhooks, and the admin provisioning endpoint.
  exports: [STRIPE_CLIENT, PlatformSettingsService, SeatBillingService],
})
export class BillingModule {}
