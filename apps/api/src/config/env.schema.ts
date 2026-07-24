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
  // The recurring Stripe Price ids for the paid plans (incl. VAT): Pro £9.97/mo,
  // Centre £19.97/mo. Resolved at runtime by subscriptions checkout (env wins,
  // the seeded PlanEntitlement.stripePriceId is the fallback), so setting these
  // in Railway + redeploy activates subscriptions with no re-seed. Optional at
  // boot: an unset plan cleanly returns "not configured" rather than crashing.
  // Treat blank as unset. See docs/adr/0036-payment-go-live.md.
  STRIPE_PRICE_ID_PRO: z
    .string()
    .min(1)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  STRIPE_PRICE_ID_CENTRE: z
    .string()
    .min(1)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // The recurring Stripe Price id (£5/mo incl. VAT) for an extra Centre team
  // seat beyond the 3 included. Optional at boot: the app runs without it, and
  // "add a seat" returns a clean "not configured" until it's set. Treat blank
  // as unset. See docs/adr/0035-seat-based-billing.md.
  STRIPE_CENTRE_SEAT_PRICE_ID: z
    .string()
    .min(1)
    .optional()
    .or(z.literal("").transform(() => undefined)),

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

  // Error monitoring. When set, the API initialises Sentry (see
  // observability/sentry.ts, called from main.ts) and reports 5xx errors via a
  // global exception filter; unset = monitoring disabled (a clean no-op). Treat
  // unset/blank as "not provided" rather than failing url() on an empty string.
  SENTRY_DSN: z
    .string()
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),

  // Secret used to encrypt customers' stored CRM API keys at rest (AES-256-GCM,
  // see common/crypto.service.ts). A 64-char hex or 32-byte base64 string is
  // used as the key directly; anything else is SHA-256-hashed to 32 bytes.
  // Optional at boot: without it the app runs, but connecting a CRM returns a
  // clean "not configured" instead of storing a key unencrypted.
  CREDENTIALS_ENCRYPTION_KEY: z
    .string()
    .min(1)
    .optional()
    .or(z.literal("").transform(() => undefined)),

  // HubSpot OAuth (see docs/adr/0015-crm-integrations.md, Phase 3). Optional: the
  // app boots without them and connecting HubSpot returns a clean "not
  // configured" until all three are set. The redirect URI must exactly match the
  // one registered in the HubSpot app (…/integrations/oauth/hubspot/callback on
  // this API's public host). Treat blank the same as unset.
  HUBSPOT_CLIENT_ID: z
    .string()
    .min(1)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  HUBSPOT_CLIENT_SECRET: z
    .string()
    .min(1)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  HUBSPOT_REDIRECT_URI: z
    .string()
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),

  // Transactional email via Brevo (birthday reminders, guest receipts — see
  // docs/adr/0025). A PLATFORM key (not the per-account CRM keys). Named
  // `Brevo_API` to match the Railway variable. Optional: the app boots without
  // it and the email client becomes a logged no-op, so reminders simply don't
  // send until it's configured. Treat blank as unset.
  Brevo_API: z
    .string()
    .min(1)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // The sender emails come from. Must be a VERIFIED sender in the Brevo account.
  // Optional when every email uses a Brevo template (the template carries its own
  // sender); required for the built-in HTML fallbacks. `.trim()` tolerates stray
  // whitespace pasted into the dashboard; `.catch(undefined)` means a BLANK or
  // MALFORMED value degrades to "unset" (email disabled) rather than throwing —
  // a peripheral email-config typo must never crash the whole API on boot.
  EMAIL_FROM_ADDRESS: z.string().trim().email().optional().catch(undefined),
  // Falls back to the default on a missing OR blank/invalid value (never throws).
  EMAIL_FROM_NAME: z.string().trim().min(1).catch("Kudos Cards").default("Kudos Cards"),
  // Optional Brevo transactional template IDs. Set one to design that email in
  // the Brevo dashboard instead of using our built-in HTML; unset = HTML
  // fallback. The template receives the params documented in each email's
  // send site (see reminders.service.ts / webhooks.service.ts). `.catch(undefined)`
  // so a blank OR non-numeric value degrades to "no template" rather than
  // crashing the whole API on boot.
  BREVO_REMINDER_TEMPLATE_ID: z.coerce.number().int().positive().optional().catch(undefined),
  BREVO_GUEST_RECEIPT_TEMPLATE_ID: z.coerce.number().int().positive().optional().catch(undefined),
  BREVO_ORDER_CONFIRMATION_TEMPLATE_ID: z.coerce.number().int().positive().optional().catch(undefined),
  BREVO_DISPATCH_TEMPLATE_ID: z.coerce.number().int().positive().optional().catch(undefined),
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
