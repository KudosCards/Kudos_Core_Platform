import type { Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient } from "@supabase/supabase-js";
import type { EnvConfig } from "../config/env.schema";

export const SUPABASE_ADMIN_CLIENT = Symbol("SUPABASE_ADMIN_CLIENT");

/**
 * Service-role Supabase client used for **auth admin** operations — creating an
 * operator's auth user and minting one-time set-password / recovery links
 * (`auth.admin.generateLink`). Same service-role credentials the storage client
 * already uses (see storage/design-asset-storage.provider.ts); no new secret.
 * A dedicated token (rather than reusing the storage client) keeps the two
 * concerns independently overridable in tests — see test/util/create-test-app.ts,
 * which fakes this the same way it fakes JWKS_RESOLVER so e2e never calls the
 * real Supabase Auth API.
 */
export const supabaseAdminProvider: Provider = {
  provide: SUPABASE_ADMIN_CLIENT,
  useFactory: (config: ConfigService<EnvConfig, true>) => {
    const url = config.get("SUPABASE_URL", { infer: true });
    const serviceRoleKey = config.get("SUPABASE_SERVICE_ROLE_KEY", { infer: true });
    return createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  },
  inject: [ConfigService],
};
