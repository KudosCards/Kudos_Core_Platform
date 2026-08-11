import type { Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvConfig } from "../../config/env.schema";
import { GOHIGHLEVEL_CLIENT } from "./gohighlevel-client";
import { HttpGoHighLevelClient } from "./http-gohighlevel-client";

/**
 * Binds GOHIGHLEVEL_CLIENT to the real HTTP client, built from the OAuth config.
 * When the GoHighLevel env vars aren't set the client is still constructed (with
 * empty strings) but never reached — CrmConnectionsService gates on the
 * provider's config first and returns a clean "not configured". Overridden with a
 * mock in e2e tests so no test reaches the GoHighLevel network.
 */
export const gohighlevelClientProvider: Provider = {
  provide: GOHIGHLEVEL_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService<EnvConfig, true>) =>
    new HttpGoHighLevelClient(
      config.get("GOHIGHLEVEL_CLIENT_ID", { infer: true }) ?? "",
      config.get("GOHIGHLEVEL_CLIENT_SECRET", { infer: true }) ?? "",
      config.get("GOHIGHLEVEL_REDIRECT_URI", { infer: true }) ?? "",
    ),
};
