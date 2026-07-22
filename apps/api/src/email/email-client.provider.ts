import { Logger, type Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvConfig } from "../config/env.schema";
import { EMAIL_CLIENT, type EmailClient } from "./email.client";
import { HttpBrevoEmailClient } from "./http-brevo-email.client";
import { NoopEmailClient } from "./noop-email.client";

/**
 * Wires the real Brevo client when a key + from-address are configured,
 * otherwise a no-op that logs and drops — so the API boots and reminders/receipts
 * degrade gracefully until Brevo is set up in the environment. Overridable in
 * tests (see test/util/create-test-app.ts) like STRIPE_CLIENT / BREVO_CLIENT.
 */
export const emailClientProvider: Provider = {
  provide: EMAIL_CLIENT,
  useFactory: (config: ConfigService<EnvConfig, true>): EmailClient => {
    const apiKey = config.get("Brevo_API", { infer: true });
    const fromAddress = config.get("EMAIL_FROM_ADDRESS", { infer: true });
    const fromName = config.get("EMAIL_FROM_NAME", { infer: true });
    if (!apiKey) {
      new Logger("EmailClientProvider").warn(
        "Brevo_API not set — transactional email disabled (no-op).",
      );
      return new NoopEmailClient();
    }
    if (!fromAddress) {
      // Fine if every email uses a Brevo template (it carries its own sender);
      // the HTML fallbacks will fail at Brevo without a verified sender.
      new Logger("EmailClientProvider").warn(
        "EMAIL_FROM_ADDRESS not set — only Brevo-template emails will send; HTML fallbacks need a verified sender.",
      );
    }
    return new HttpBrevoEmailClient(apiKey, fromAddress, fromName);
  },
  inject: [ConfigService],
};
