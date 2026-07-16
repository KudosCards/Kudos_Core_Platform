import type { Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Stripe from "stripe";
import type { EnvConfig } from "../config/env.schema";

export const STRIPE_CLIENT = Symbol("STRIPE_CLIENT");

/**
 * Overridable in tests (see test/util/create-test-app.ts) the same way
 * JWKS_RESOLVER and DESIGN_ASSET_STORAGE_CLIENT are — nothing in this
 * codebase's automated tests ever makes a real Stripe API call.
 */
export const stripeClientProvider: Provider = {
  provide: STRIPE_CLIENT,
  useFactory: (config: ConfigService<EnvConfig, true>): Stripe => {
    return new Stripe(config.get("STRIPE_SECRET_KEY", { infer: true }));
  },
  inject: [ConfigService],
};
