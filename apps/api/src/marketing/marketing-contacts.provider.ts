import { Logger, type Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvConfig } from "../config/env.schema";
import {
  MARKETING_CONTACTS_CLIENT,
  type MarketingContactsClient,
} from "./marketing-contacts.client";
import { HttpMarketingContactsClient } from "./http-marketing-contacts.client";
import { NoopMarketingContactsClient } from "./noop-marketing-contacts.client";

/**
 * Wires the real Brevo marketing-contacts client when the platform Brevo key is
 * set, otherwise a no-op that logs and drops — so the API boots and signup works
 * even before Brevo is configured. Reuses the SAME `Brevo_API` platform key as
 * transactional email (one Brevo account). Overridable in tests (see
 * test/util/create-test-app.ts) like EMAIL_CLIENT / STRIPE_CLIENT.
 */
export const marketingContactsClientProvider: Provider = {
  provide: MARKETING_CONTACTS_CLIENT,
  useFactory: (config: ConfigService<EnvConfig, true>): MarketingContactsClient => {
    const apiKey = config.get("Brevo_API", { infer: true });
    if (!apiKey) {
      new Logger("MarketingContactsClientProvider").warn(
        "Brevo_API not set — subscriber marketing-list sync disabled (no-op).",
      );
      return new NoopMarketingContactsClient();
    }
    return new HttpMarketingContactsClient(apiKey);
  },
  inject: [ConfigService],
};
