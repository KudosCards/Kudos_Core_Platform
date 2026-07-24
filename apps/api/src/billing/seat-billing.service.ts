import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import type { EnvConfig } from "../config/env.schema";
import { STRIPE_CLIENT } from "./stripe-client.provider";
import { CENTRE_SEAT_PRICE_MINOR } from "./billing.constants";
import { PlatformSettingsService, PLATFORM_SETTING_KEYS } from "./platform-settings.service";

/** Stable Stripe lookup_key for the extra-seat price, so provisioning is
 * idempotent and matches the standalone create-stripe-prices script — running
 * either one finds/reuses the same Price rather than duplicating it. */
const SEAT_LOOKUP_KEY = "kudos_centre_seat_monthly";

export interface SeatPriceStatus {
  /** The resolved Stripe Price id, or null if seat billing isn't set up yet. */
  priceId: string | null;
  /** Where the id came from: an env var, the DB store, or not configured. */
  source: "env" | "platform_setting" | "unconfigured";
}

/**
 * Resolves — and, on demand, provisions — the Stripe Price behind the £5/mo
 * extra Centre seat. The id is resolved at runtime as `STRIPE_CENTRE_SEAT_PRICE_ID`
 * env var first, then the PlatformSetting store. `ensureSeatPrice` creates the
 * Price against the live Stripe account (using the injected client) and stores
 * its id — so a platform admin can turn seat billing on from the running app,
 * with no Stripe dashboard, env var, or redeploy. See docs/adr/0037.
 */
@Injectable()
export class SeatBillingService {
  private readonly logger = new Logger(SeatBillingService.name);

  constructor(
    private readonly config: ConfigService<EnvConfig, true>,
    private readonly settings: PlatformSettingsService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  /** The seat Price id if configured, env winning over the DB store. */
  async resolveSeatPriceId(): Promise<string | null> {
    return (await this.status()).priceId;
  }

  async status(): Promise<SeatPriceStatus> {
    const fromEnv = this.config.get("STRIPE_CENTRE_SEAT_PRICE_ID", { infer: true });
    if (fromEnv) {
      return { priceId: fromEnv, source: "env" };
    }
    const fromDb = await this.settings.get(PLATFORM_SETTING_KEYS.centreSeatPriceId);
    if (fromDb) {
      return { priceId: fromDb, source: "platform_setting" };
    }
    return { priceId: null, source: "unconfigured" };
  }

  /**
   * Ensure a live Stripe Price for the extra seat exists and its id is stored,
   * so seat purchasing works immediately afterwards. Idempotent:
   *  - if an env var already provides the id, that wins — nothing is created;
   *  - else if a Price with our lookup_key already exists (or we already stored
   *    one), reuse it;
   *  - else create the £5/mo GBP VAT-inclusive Price and store its id.
   * Runs against whatever key the deployed API holds (live in production).
   */
  async ensureSeatPrice(): Promise<SeatPriceStatus> {
    const envId = this.config.get("STRIPE_CENTRE_SEAT_PRICE_ID", { infer: true });
    if (envId) {
      // An explicit env var is the operator's override — respect it, don't
      // create a competing Price.
      return { priceId: envId, source: "env" };
    }

    // Already provisioned before? Trust the stored id (avoids a Stripe call).
    const stored = await this.settings.get(PLATFORM_SETTING_KEYS.centreSeatPriceId);
    if (stored) {
      return { priceId: stored, source: "platform_setting" };
    }

    // Look for an existing Price by our lookup_key (immediately consistent) so a
    // re-run — or a prior create-stripe-prices script run — reuses it.
    const existing = await this.stripe.prices.list({
      lookup_keys: [SEAT_LOOKUP_KEY],
      active: true,
      limit: 1,
    });
    let priceId = existing.data[0]?.id;

    if (!priceId) {
      const price = await this.stripe.prices.create({
        currency: "gbp",
        unit_amount: CENTRE_SEAT_PRICE_MINOR,
        recurring: { interval: "month" },
        tax_behavior: "inclusive",
        lookup_key: SEAT_LOOKUP_KEY,
        nickname: "Kudos Cards — Centre extra seat (£5.00/mo incl. VAT)",
        product_data: { name: "Kudos Cards — Centre extra seat" },
      });
      priceId = price.id;
      this.logger.log(`Created Stripe extra-seat Price ${priceId}`);
    } else {
      this.logger.log(`Reusing existing Stripe extra-seat Price ${priceId}`);
    }

    await this.settings.set(PLATFORM_SETTING_KEYS.centreSeatPriceId, priceId);
    return { priceId, source: "platform_setting" };
  }
}
