import { z } from "zod";

/**
 * A URL that must use the http or https scheme. `z.string().url()` alone is not
 * enough: `new URL("ttps://kudos-cards.co.uk")` succeeds (it treats `ttps:` as a
 * valid — if nonsensical — scheme), so a single-character typo passed validation
 * and booted the API with a dead CORS origin, silently locking the real domain
 * out of the whole backend. Requiring http(s) makes that typo fail loudly at
 * boot instead. See docs/adr/0081-cors-allowlist-and-url-validation.md.
 */
const httpUrl = z
  .string()
  .url()
  .refine(
    (value) => {
      try {
        const { protocol } = new URL(value);
        return protocol === "http:" || protocol === "https:";
      } catch {
        return false;
      }
    },
    { message: "must be an http(s) URL (e.g. https://kudos-cards.co.uk)" },
  );

/**
 * Validated once at boot. The process refuses to start with a missing or
 * malformed env var rather than failing later, at first use, in production.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),

  // Number of reverse-proxy hops in front of the API, set as Express's
  // `trust proxy` (see configure-app.ts). This is what makes `req.ip` — and so
  // the per-IP rate limiting on every public endpoint — the REAL client, not
  // our hosting edge proxy. Without it every anonymous request shares the
  // proxy's single IP and one global rate-limit bucket, so the per-user limits
  // are effectively global. It MUST be an exact hop count, never `true`: with
  // `true`, Express trusts a client-supplied X-Forwarded-For, letting anyone
  // spoof their IP and dodge the limit — worse than no trust at all. Railway's
  // edge is a single hop, hence the default of 1; put a CDN/WAF in front and it
  // becomes 2. Set 0 to trust nothing (falls back to the socket IP — the old,
  // pre-fix behaviour) as a safe escape hatch. Verify the value resolves the
  // real client IP in staging before trusting it — see
  // docs/adr/0133-trust-proxy-and-rate-limit-integrity.md.
  TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().default(1).catch(1),

  // Enables the GET /health/ip diagnostic (echoes how Express resolved the
  // caller's IP) used to verify TRUST_PROXY_HOPS against the real proxy
  // topology — see ADR 0133. OFF by default: the route returns 404 unless this
  // is exactly "true" or "1". Turn it on temporarily to re-verify after any
  // change to the edge/proxy setup, then turn it back off. Kept as a plain
  // string so ConfigService reads it live; blank ⇒ unset (disabled).
  IP_DIAGNOSTIC_ENABLED: z
    .string()
    .optional()
    .or(z.literal("").transform(() => undefined)),

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
  // Optional override for the Stripe billing-portal configuration id. Unset is
  // the norm: BillingPortalService creates a configuration over the API on first
  // use and stores it, so the portal works with no dashboard step. Set this only
  // to pin a specific dashboard-built configuration. Treat blank as unset. See
  // docs/adr/0038-billing-portal.md.
  STRIPE_BILLING_PORTAL_CONFIG_ID: z
    .string()
    .min(1)
    .optional()
    .or(z.literal("").transform(() => undefined)),

  // The canonical public origin of the web app (custom domain). Used for CORS,
  // Stripe redirects, and every auth-email link. Must be http(s) — see `httpUrl`.
  WEB_APP_URL: httpUrl,

  // Shared secret for telling the web app to publish a fresh catalog, sent as
  // `x-catalog-revalidate-secret` when a sync finishes. Must match
  // CATALOG_REVALIDATE_SECRET on the web app. Optional; unset ⇒ the sync still
  // runs and simply reports that it couldn't publish, so the catalog falls back
  // to the hourly ISR window. See docs/adr/0044-public-catalog-isr.md.
  CATALOG_REVALIDATE_SECRET: z
    .string()
    .min(1)
    .optional()
    .or(z.literal("").transform(() => undefined)),

  // Extra browser origins allowed to call the API beyond WEB_APP_URL, as a
  // comma-separated list (e.g. "https://www.kudos-cards.co.uk"). The CORS
  // allow-list is [WEB_APP_URL, ...these], so a single wrong value can no longer
  // black out the whole app. Optional; blank ⇒ unset. See ADR 0081.
  CORS_ALLOWED_ORIGINS: z
    .string()
    .min(1)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // Comma-separated origin SUFFIXES also allowed — for dynamic hosts like Netlify
  // deploy previews (e.g. "--kudos-cards.netlify.app"). Matched against the tail
  // of the request Origin. Optional; blank ⇒ unset. See ADR 0081.
  CORS_ALLOWED_ORIGIN_SUFFIXES: z
    .string()
    .min(1)
    .optional()
    .or(z.literal("").transform(() => undefined)),

  // Orphaned-asset reaper (see docs/adr/0074-orphaned-asset-reaper.md). Deleting
  // storage objects is irreversible, so it ships DARK: it only ever deletes when
  // STORAGE_REAPER_ENABLED is exactly "true" or "1" (interpreted in the service,
  // kept as a plain string here so ConfigService reads it live). Unset/anything
  // else ⇒ the scheduled run is a logged no-op and a manual trigger runs in
  // dry-run (report only). STORAGE_REAPER_GRACE_DAYS is how old an unreferenced
  // object must be before it's eligible — a safety window so an in-progress
  // upload or edit is never reaped; defaults to 7, blank/invalid → the default.
  STORAGE_REAPER_ENABLED: z
    .string()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  STORAGE_REAPER_GRACE_DAYS: z.coerce.number().int().positive().default(7).catch(7),

  // Message-page engagement event capture (see docs/adr/0136-message-page-analytics.md,
  // Phase 2). Ships DARK: the public view/click/reply endpoints only write a
  // MessagePageEvent row when this is exactly "true" or "1" (interpreted in the
  // service, kept a plain string here so ConfigService reads it live). Unset/
  // anything else ⇒ no events are written and nothing else changes. Kept in env,
  // not PlatformSetting, on purpose — the switch must not depend on a DB read,
  // since what it disables is DB write load on the public hot path. Flip it off
  // to stop capture instantly with no redeploy.
  MESSAGE_EVENTS_ENABLED: z
    .string()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // How long a raw MessagePageEvent is kept before the daily retention cron
  // (ADR 0136, Phase 3) prunes it. Charts only ever read a bounded window and
  // the lifetime counters on MessagePageLink hold long-term totals, so raw
  // events past this age are pure storage/WAL cost. Calendar days; blank/invalid
  // falls back to the default of 90. Pruning runs regardless of
  // MESSAGE_EVENTS_ENABLED so a table left behind after capture is switched off
  // still drains.
  MESSAGE_EVENTS_RETENTION_DAYS: z.coerce.number().int().positive().default(90).catch(90),

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

  // Royal Mail Shipping API v4 (Click & Drop / Intersoft) — creates shipments,
  // buys postage, and allocates a tracking number from the ops fulfillment
  // queue. Optional: with no key the shipping client is a no-op and ops keep
  // dispatching manually (paste-your-own tracking). Treat blank as unset. See
  // docs/adr/0072-royal-mail-shipping.md.
  ROYAL_MAIL_API_KEY: z
    .string()
    .min(1)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // The Shipping API base URL. Defaults to the live host; point at the sandbox
  // for test-mode verification before go-live.
  ROYAL_MAIL_API_BASE_URL: z.string().url().default("https://api.parcel.royalmail.com"),
  // Royal Mail Shipping API service codes per postage class. Account-specific, so
  // overridable without a redeploy; the defaults in royal-mail-client.ts apply
  // when unset and MUST be confirmed against the live account (see ADR 0072/0096).
  ROYAL_MAIL_SERVICE_CODE_FIRST: z.string().min(1).optional(),
  ROYAL_MAIL_SERVICE_CODE_SECOND: z.string().min(1).optional(),

  // Royal Mail Click & Drop *Orders API* — a different product from the Shipping
  // API above. This IMPORTS each paid card as an order into the operator's Click
  // & Drop dashboard queue (to batch, label, and dispatch there), rather than
  // creating a finished shipment server-side. Optional: with no key the Click &
  // Drop client is a no-op and nothing is pushed. Treat blank as unset. The key
  // is the "Click & Drop API authorization key" from Settings → Integrations. See
  // docs/adr/0095-click-and-drop-import.md.
  CLICK_AND_DROP_API_KEY: z
    .string()
    .min(1)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  CLICK_AND_DROP_API_BASE_URL: z.string().url().default("https://api.parcel.royalmail.com"),
  // How the API key is sent in the Authorization header. Royal Mail's own cURL
  // example uses the raw key ("raw", the default); flip to "bearer" if an account
  // needs the "Bearer <key>" scheme — no code change required.
  CLICK_AND_DROP_AUTH_SCHEME: z.enum(["raw", "bearer"]).default("raw"),
  // Optional Click & Drop service codes per postage class. When unset (default),
  // the order imports with no service selected so the operator picks it in the
  // dashboard — the safest default until the account's exact codes are confirmed.
  CLICK_AND_DROP_SERVICE_CODE_FIRST: z.string().min(1).optional(),
  CLICK_AND_DROP_SERVICE_CODE_SECOND: z.string().min(1).optional(),

  // Estimated-arrival notification (ADR 0124). Our cards go on ordinary stamps,
  // which Royal Mail does not track — so we can't observe delivery. Instead a
  // daily sweep estimates arrival from the posted date + the postage class's
  // expected transit (working days, UK holiday-aware) and emails the buyer an
  // honest "should have arrived" note, marking the card delivered (estimated) so
  // the order completes. Off unless ARRIVAL_NOTIFICATIONS_ENABLED is exactly
  // "true" or "1" (interpreted in the service; kept a plain string so
  // ConfigService reads it live) — because it both emails customers and advances
  // order state on an estimate, it's explicit opt-in.
  ARRIVAL_NOTIFICATIONS_ENABLED: z
    .string()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // Expected transit in WORKING days per postage class — Royal Mail's own aims
  // (1st ≈ next working day, 2nd ≈ 2–3). Tunable without a code change;
  // blank/invalid falls back to the default.
  ARRIVAL_FIRST_CLASS_WORKING_DAYS: z.coerce.number().int().positive().default(1).catch(1),
  ARRIVAL_SECOND_CLASS_WORKING_DAYS: z.coerce.number().int().positive().default(3).catch(3),
  // How recently a card must have been posted to still be eligible for an arrival
  // email (calendar days). Bounds the sweep to cards genuinely around their
  // arrival window and stops a historical `posted` backlog from being emailed +
  // auto-completed in one go on first enable. Default 14.
  ARRIVAL_MAX_POSTED_AGE_DAYS: z.coerce.number().int().positive().default(14).catch(14),

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

  // GoHighLevel (HighLevel) Marketplace-app OAuth credentials, for the per-account
  // contact import (see docs/adr/0015-crm-integrations.md). All three optional at
  // boot: without them the app runs and connecting GoHighLevel returns a clean
  // "not configured" until all are set. The redirect URI must exactly match the
  // one registered in the Marketplace app. GoHighLevel's white-label policy
  // rejects a redirect URL containing "highlevel"/"gohighlevel", so it's
  // registered under the neutral slug: …/integrations/oauth/leadconnector/callback
  // on this API's public host (the controller maps that slug back to the
  // gohighlevel provider — see ADR 0156). Treat blank the same as unset.
  GOHIGHLEVEL_CLIENT_ID: z
    .string()
    .min(1)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  GOHIGHLEVEL_CLIENT_SECRET: z
    .string()
    .min(1)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  GOHIGHLEVEL_REDIRECT_URI: z
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
  // Brevo marketing lists that new subscribers are added to at signup, split by
  // account type (see docs/adr/0152-subscriber-marketing-lists.md). Defaults are
  // the platform's real list ids (5 = personal/individual, 6 = organisation), so
  // the split works out-of-the-box; override per-environment if they differ.
  // `.catch(default)` so a blank/non-numeric value degrades to the default rather
  // than crashing the whole API on boot, matching the other Brevo config.
  BREVO_LIST_ID_INDIVIDUAL: z.coerce.number().int().positive().catch(5).default(5),
  BREVO_LIST_ID_ORGANISATION: z.coerce.number().int().positive().catch(6).default(6),
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
  BREVO_ORDER_CONFIRMATION_TEMPLATE_ID: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .catch(undefined),
  BREVO_DISPATCH_TEMPLATE_ID: z.coerce.number().int().positive().optional().catch(undefined),
  // Estimated-arrival "your card should have arrived" email (see ADR 0124).
  BREVO_ARRIVAL_TEMPLATE_ID: z.coerce.number().int().positive().optional().catch(undefined),
  // Returned-to-Sender "please update the address" email (see ADR 0039).
  BREVO_RTS_TEMPLATE_ID: z.coerce.number().int().positive().optional().catch(undefined),
  // Support ticketing (see ADR 0066). Optional Brevo templates for the two
  // notification emails — a support reply (to the customer) and a new/updated
  // ticket (to the support inbox); unset ⇒ the built-in HTML fallback.
  BREVO_SUPPORT_REPLY_TEMPLATE_ID: z.coerce.number().int().positive().optional().catch(undefined),
  BREVO_SUPPORT_TICKET_TEMPLATE_ID: z.coerce.number().int().positive().optional().catch(undefined),
  // Where new tickets and customer replies are emailed so the Kudos support
  // team is alerted. Optional: unset ⇒ no team alert email is sent (the ticket
  // is still visible in the ops queue). Blank/malformed degrades to unset rather
  // than crashing on boot, matching EMAIL_FROM_ADDRESS.
  SUPPORT_INBOX_EMAIL: z.string().trim().email().optional().catch(undefined),
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
