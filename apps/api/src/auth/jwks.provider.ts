import type { Provider } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import type { EnvConfig } from "../config/env.schema";

export const JWKS_RESOLVER = Symbol("JWKS_RESOLVER");

/**
 * Supabase signs session JWTs asymmetrically (ECC P-256 as of the current
 * generation of Supabase projects) and publishes the verification keys at
 * this well-known JWKS endpoint — so verification needs no shared secret,
 * and key rotation (Supabase can rotate signing keys, e.g. the "previous
 * key" visible in a project's JWT Keys settings) is handled automatically
 * by re-fetching this endpoint, not by us tracking secret versions.
 */
export const jwksResolverProvider: Provider = {
  provide: JWKS_RESOLVER,
  useFactory: (config: ConfigService<EnvConfig, true>): JWTVerifyGetKey => {
    const supabaseUrl = config.get("SUPABASE_URL", { infer: true });
    return createRemoteJWKSet(new URL("/auth/v1/.well-known/jwks.json", supabaseUrl));
  },
  inject: [ConfigService],
};
