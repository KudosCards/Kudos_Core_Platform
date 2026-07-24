import { ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import type { EnvConfig } from "../config/env.schema";
import { AuditService } from "../audit/audit.service";
import { STRIPE_CLIENT } from "./stripe-client.provider";
import { StripeCustomerService } from "./stripe-customer.service";
import { PlatformSettingsService, PLATFORM_SETTING_KEYS } from "./platform-settings.service";

/**
 * Opens Stripe's hosted **Customer Portal** for an account so customers can
 * download their invoices and receipts, update their card, and cancel — all
 * on Stripe-hosted pages, so we store no card data and build no billing UI.
 *
 * The portal needs a **configuration** (which features to show). Rather than
 * relying on the account's default configuration — which has to be activated
 * once by hand in the Stripe Dashboard — this service creates a configuration
 * over the API and stores its id, so the portal works from a fresh deploy with
 * no dashboard step. Same "provision from the running app" approach as the
 * seat price (see SeatBillingService / docs/adr/0037), extended in ADR 0038.
 */
@Injectable()
export class BillingPortalService {
  private readonly logger = new Logger(BillingPortalService.name);

  constructor(
    private readonly config: ConfigService<EnvConfig, true>,
    private readonly customers: StripeCustomerService,
    private readonly settings: PlatformSettingsService,
    private readonly audit: AuditService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  /**
   * Create a one-time, signed Stripe billing-portal URL for the account and
   * return it. The caller redirects the browser there; the customer manages
   * their billing and lands back on `/billing` when done.
   */
  async createSession(accountId: string, actorUserId: string): Promise<{ url: string }> {
    const customerId = await this.customers.getOrCreate(accountId);
    const configuration = await this.ensurePortalConfigurationId();
    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });

    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      configuration,
      return_url: `${webAppUrl}/billing`,
    });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "billing_portal_opened",
      targetType: "Account",
      targetId: accountId,
      metadata: { stripePortalSessionId: session.id },
    });

    if (!session.url) {
      throw new ConflictException("Stripe did not return a billing-portal URL");
    }
    return { url: session.url };
  }

  /**
   * The billing-portal configuration id to use, resolved once and cached in the
   * PlatformSetting store: an explicit `STRIPE_BILLING_PORTAL_CONFIG_ID` env var
   * wins (an operator override — e.g. a dashboard-built configuration), then a
   * previously stored id, otherwise we create one against Stripe and store it.
   */
  private async ensurePortalConfigurationId(): Promise<string> {
    const fromEnv = this.config.get("STRIPE_BILLING_PORTAL_CONFIG_ID", { infer: true });
    if (fromEnv) {
      return fromEnv;
    }

    const stored = await this.settings.get(PLATFORM_SETTING_KEYS.billingPortalConfigId);
    if (stored) {
      return stored;
    }

    const configuration = await this.stripe.billingPortal.configurations.create({
      business_profile: { headline: "Kudos Cards — manage your billing" },
      features: {
        // The reason customers come here: their invoices and PDF receipts.
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        customer_update: {
          enabled: true,
          allowed_updates: ["email", "address", "name", "tax_id"],
        },
        // Let them cancel — but at period end, so they keep what they've paid
        // for until it runs out (no mid-cycle loss, matching how we bill).
        subscription_cancel: { enabled: true, mode: "at_period_end" },
      },
    });

    await this.settings.set(PLATFORM_SETTING_KEYS.billingPortalConfigId, configuration.id);
    this.logger.log(`Created Stripe billing-portal configuration ${configuration.id}`);
    return configuration.id;
  }
}
