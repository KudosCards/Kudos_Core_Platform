import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { STRIPE_CLIENT, stripeClientProvider } from "./stripe-client.provider";
import { PlatformSettingsService } from "./platform-settings.service";
import { SeatBillingService } from "./seat-billing.service";
import { StripeCustomerService } from "./stripe-customer.service";
import { BillingPortalService } from "./billing-portal.service";

@Module({
  imports: [AuditModule],
  providers: [
    stripeClientProvider,
    PlatformSettingsService,
    SeatBillingService,
    StripeCustomerService,
    BillingPortalService,
  ],
  // SeatBillingService (and the raw client) are consumed by subscriptions,
  // webhooks, and the admin provisioning endpoint; StripeCustomerService and
  // BillingPortalService by subscription checkout and the billing-portal endpoint.
  exports: [
    STRIPE_CLIENT,
    PlatformSettingsService,
    SeatBillingService,
    StripeCustomerService,
    BillingPortalService,
  ],
})
export class BillingModule {}
