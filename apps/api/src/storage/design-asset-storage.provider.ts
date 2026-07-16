import type { Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient } from "@supabase/supabase-js";
import type { EnvConfig } from "../config/env.schema";

export const DESIGN_ASSET_STORAGE_CLIENT = Symbol("DESIGN_ASSET_STORAGE_CLIENT");

/**
 * Service-role Supabase client, used only for generating signed Storage
 * upload URLs (see storage.service.ts) — never exposed to clients directly.
 * Same env vars JwtAuthGuard already relies on (see jwks.provider.ts), no
 * new secrets needed.
 */
export const designAssetStorageProvider: Provider = {
  provide: DESIGN_ASSET_STORAGE_CLIENT,
  useFactory: (config: ConfigService<EnvConfig, true>) => {
    const supabaseUrl = config.get("SUPABASE_URL", { infer: true });
    const serviceRoleKey = config.get("SUPABASE_SERVICE_ROLE_KEY", { infer: true });
    return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  },
  inject: [ConfigService],
};
