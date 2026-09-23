import type { Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvConfig } from "../config/env.schema";
import { AnthropicMessageDrafter, type MessageDrafter } from "./message-drafting.client";

/**
 * The thing that talks to the model, or nothing at all.
 *
 * `null` when no API key is configured, which is what makes the feature dark
 * by default rather than broken by default: the service reports it as
 * unavailable, the page offers no button, and the route says so plainly.
 *
 * A provider rather than a `new` inside the service so an e2e can swap in a
 * stub and never reach the network — the pattern STRIPE_CLIENT, JWKS_RESOLVER
 * and CATALOG_SOURCE already use. That is not only a testing convenience: a
 * test that reached the real API would send somebody's brief to a model, and a
 * test suite is not a thing anybody consented to.
 */
export const MESSAGE_DRAFTER = Symbol("MESSAGE_DRAFTER");

export const messageDrafterProvider: Provider = {
  provide: MESSAGE_DRAFTER,
  useFactory: (config: ConfigService<EnvConfig, true>): MessageDrafter | null => {
    const apiKey = config.get("ANTHROPIC_API_KEY", { infer: true });
    if (!apiKey) return null;
    return new AnthropicMessageDrafter(
      apiKey,
      config.get("ANTHROPIC_MODEL", { infer: true }),
      config.get("ANTHROPIC_BASE_URL", { infer: true }),
    );
  },
  inject: [ConfigService],
};
