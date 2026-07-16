import { z } from "zod";

/**
 * Validated once at boot. The process refuses to start with a missing or
 * malformed env var rather than failing later, at first use, in production.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),

  // Also used to derive the JWKS endpoint (SUPABASE_URL + /auth/v1/.well-known/jwks.json)
  // that JwtAuthGuard verifies session tokens against — see auth/jwks.provider.ts.
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),

  WEB_APP_URL: z.string().url(),

  // Airtable-sourced card catalog (see docs/adr/0011-airtable-catalog-sync.md).
  // Optional: the app boots without them; the catalog sync reports "not
  // configured" until both are set. Treat blank the same as unset.
  AIRTABLE_API_KEY: z
    .string()
    .min(1)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  AIRTABLE_BASE_ID: z
    .string()
    .min(1)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // The table holding the card designs; defaults to the name in the Airtable base.
  AIRTABLE_CARDS_TABLE: z.string().min(1).default("Card List"),

  // Treat an unset/blank env var the same as "not provided" rather than
  // failing url() validation on an empty string.
  SENTRY_DSN: z
    .string()
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
