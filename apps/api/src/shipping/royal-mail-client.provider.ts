import type { Provider } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvConfig } from "../config/env.schema";
import {
  HttpRoyalMailClient,
  NoopRoyalMailClient,
  type RoyalMailClient,
  type RoyalMailServiceCodes,
} from "./royal-mail-client";

export const ROYAL_MAIL_CLIENT = Symbol("ROYAL_MAIL_CLIENT");

/**
 * Wires the real Royal Mail client only when ROYAL_MAIL_API_KEY is set;
 * otherwise a no-op so the app boots and ops keep dispatching manually. Always
 * overridable in tests (see test/util/create-test-app.ts), the same way
 * STRIPE_CLIENT / DESIGN_ASSET_STORAGE_CLIENT are — no test ever hits the real
 * Royal Mail API.
 */
export const royalMailClientProvider: Provider = {
  provide: ROYAL_MAIL_CLIENT,
  useFactory: (config: ConfigService<EnvConfig, true>): RoyalMailClient => {
    const apiKey = config.get("ROYAL_MAIL_API_KEY", { infer: true });
    if (!apiKey) {
      new Logger("RoyalMailClient").log(
        "ROYAL_MAIL_API_KEY unset — shipping automation disabled (manual dispatch).",
      );
      return new NoopRoyalMailClient();
    }
    const baseUrl = config.get("ROYAL_MAIL_API_BASE_URL", { infer: true });
    const serviceCodes: RoyalMailServiceCodes = {
      first_class: config.get("ROYAL_MAIL_SERVICE_CODE_FIRST", { infer: true }),
      second_class: config.get("ROYAL_MAIL_SERVICE_CODE_SECOND", { infer: true }),
    };
    return new HttpRoyalMailClient(apiKey, baseUrl, serviceCodes);
  },
  inject: [ConfigService],
};
