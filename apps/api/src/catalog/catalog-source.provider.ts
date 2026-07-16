import type { Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvConfig } from "../config/env.schema";
import { CATALOG_SOURCE } from "./catalog-source";
import { AirtableCatalogSource } from "./airtable-catalog-source";

/**
 * Binds CATALOG_SOURCE to the real Airtable implementation, built from env.
 * Overridden with a mock in e2e tests (see test/util) so no test ever reaches
 * the Airtable network — mirrors the STRIPE_CLIENT provider.
 */
export const catalogSourceProvider: Provider = {
  provide: CATALOG_SOURCE,
  useFactory: (config: ConfigService<EnvConfig, true>) =>
    new AirtableCatalogSource({
      apiKey: config.get("AIRTABLE_API_KEY", { infer: true }),
      baseId: config.get("AIRTABLE_BASE_ID", { infer: true }),
      tableName: config.get("AIRTABLE_CARDS_TABLE", { infer: true }),
    }),
  inject: [ConfigService],
};
