import type { Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvConfig } from "../../config/env.schema";
import { HUBSPOT_CLIENT } from "./hubspot-client";
import { HttpHubSpotClient } from "./http-hubspot-client";

/**
 * Binds HUBSPOT_CLIENT to the real HTTP client, built from the OAuth config.
 * When the HubSpot env vars aren't set the client is still constructed (with
 * empty strings) but never reached — CrmConnectionsService gates on
 * `isHubSpotConfigured()` first and returns a clean "not configured". Overridden
 * with a mock in e2e tests so no test reaches the HubSpot network.
 */
export const hubspotClientProvider: Provider = {
  provide: HUBSPOT_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService<EnvConfig, true>) =>
    new HttpHubSpotClient(
      config.get("HUBSPOT_CLIENT_ID", { infer: true }) ?? "",
      config.get("HUBSPOT_CLIENT_SECRET", { infer: true }) ?? "",
      config.get("HUBSPOT_REDIRECT_URI", { infer: true }) ?? "",
    ),
};
