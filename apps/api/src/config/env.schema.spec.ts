import { validateEnv } from "./env.schema";

const validConfig = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  DIRECT_URL: "postgresql://user:pass@localhost:5432/db",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "key",
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SECRET: "whsec_x",
  WEB_APP_URL: "http://localhost:3000",
};

describe("validateEnv", () => {
  it("accepts a fully valid config and applies defaults", () => {
    const result = validateEnv(validConfig);
    expect(result.NODE_ENV).toBe("development");
    expect(result.PORT).toBe(3001);
  });

  it("rejects a missing required var", () => {
    const { DATABASE_URL: _omit, ...rest } = validConfig;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it("rejects a malformed URL", () => {
    expect(() => validateEnv({ ...validConfig, SUPABASE_URL: "not-a-url" })).toThrow(
      /SUPABASE_URL/,
    );
  });

  it("rejects a WEB_APP_URL with a typo'd (non-http) scheme", () => {
    // The real incident: `ttps://…` parses as a valid URL (scheme `ttps:`), so a
    // plain url() check passed and the API booted with a dead CORS origin. It
    // must now fail loudly at boot instead.
    expect(() => validateEnv({ ...validConfig, WEB_APP_URL: "ttps://kudos-cards.co.uk" })).toThrow(
      /WEB_APP_URL/,
    );
  });

  it("accepts optional CORS allow-list vars and treats blank as unset", () => {
    const result = validateEnv({
      ...validConfig,
      CORS_ALLOWED_ORIGINS: "https://www.kudos-cards.co.uk",
      CORS_ALLOWED_ORIGIN_SUFFIXES: "",
    });
    expect(result.CORS_ALLOWED_ORIGINS).toBe("https://www.kudos-cards.co.uk");
    expect(result.CORS_ALLOWED_ORIGIN_SUFFIXES).toBeUndefined();
  });

  it("treats a blank SENTRY_DSN as not provided rather than invalid", () => {
    const result = validateEnv({ ...validConfig, SENTRY_DSN: "" });
    expect(result.SENTRY_DSN).toBeUndefined();
  });

  it("trims a valid EMAIL_FROM_ADDRESS with stray whitespace", () => {
    const result = validateEnv({ ...validConfig, EMAIL_FROM_ADDRESS: "  hi@kudoscards.co.uk \n" });
    expect(result.EMAIL_FROM_ADDRESS).toBe("hi@kudoscards.co.uk");
  });

  it("degrades a malformed EMAIL_FROM_ADDRESS to unset rather than crashing boot", () => {
    // A peripheral email-config typo (e.g. stray quotes) must never take the
    // whole API down — it should disable email, not throw.
    expect(() =>
      validateEnv({ ...validConfig, EMAIL_FROM_ADDRESS: '"not an email"' }),
    ).not.toThrow();
    const result = validateEnv({ ...validConfig, EMAIL_FROM_ADDRESS: '"not an email"' });
    expect(result.EMAIL_FROM_ADDRESS).toBeUndefined();
  });

  it("falls back to the default EMAIL_FROM_NAME on a blank value", () => {
    expect(validateEnv({ ...validConfig, EMAIL_FROM_NAME: "" }).EMAIL_FROM_NAME).toBe(
      "Kudos Cards",
    );
  });

  it("degrades a non-numeric Brevo template id to unset rather than crashing boot", () => {
    expect(() =>
      validateEnv({ ...validConfig, BREVO_REMINDER_TEMPLATE_ID: "not-a-number" }),
    ).not.toThrow();
    expect(
      validateEnv({ ...validConfig, BREVO_REMINDER_TEMPLATE_ID: "not-a-number" })
        .BREVO_REMINDER_TEMPLATE_ID,
    ).toBeUndefined();
  });

  it("still accepts a valid Brevo template id", () => {
    expect(
      validateEnv({ ...validConfig, BREVO_REMINDER_TEMPLATE_ID: "42" }).BREVO_REMINDER_TEMPLATE_ID,
    ).toBe(42);
  });
});

describe("what the environment holds after validation", () => {
  /**
   * `ConfigService.get()` reads the validated object first and `process.env`
   * second, so a value the schema rejected is only really disabled if it is
   * gone from the environment too. It was not, and the consequence was every
   * HTML email failing at Brevo with a 400 that never reached Brevo's
   * dashboard. See ADR 0267.
   */

  const KEYS = ["EMAIL_FROM_ADDRESS", "SUPPORT_INBOX_EMAIL", "BREVO_REMINDER_TEMPLATE_ID"];

  afterEach(() => {
    for (const key of KEYS) delete process.env[key];
  });

  it("removes a malformed sender address from the environment, not just from the result", () => {
    // The natural paste: a display name around the address.
    process.env.EMAIL_FROM_ADDRESS = "Kudos Cards <hello@kudos-cards.co.uk>";

    const result = validateEnv({ ...validConfig, ...process.env });

    expect(result.EMAIL_FROM_ADDRESS).toBeUndefined();
    // The part that was missing: the raw string is what the app would have read.
    expect(process.env.EMAIL_FROM_ADDRESS).toBeUndefined();
  });

  it("removes a template id that is not a number", () => {
    process.env.BREVO_REMINDER_TEMPLATE_ID = "none";

    const result = validateEnv({ ...validConfig, ...process.env });

    expect(result.BREVO_REMINDER_TEMPLATE_ID).toBeUndefined();
    expect(process.env.BREVO_REMINDER_TEMPLATE_ID).toBeUndefined();
  });

  it("leaves a good value exactly where it was", () => {
    process.env.EMAIL_FROM_ADDRESS = "noreply@kudoscards.co.uk";

    const result = validateEnv({ ...validConfig, ...process.env });

    expect(result.EMAIL_FROM_ADDRESS).toBe("noreply@kudoscards.co.uk");
    expect(process.env.EMAIL_FROM_ADDRESS).toBe("noreply@kudoscards.co.uk");
  });
});

describe("URL normalisation", () => {
  it("strips a trailing slash, because every caller interpolates a path onto it", () => {
    // `${WEB_APP_URL}/reset-password` with a trailing slash produces a doubled
    // slash, and that is the URL GoTrue checks against its allow-list.
    expect(
      validateEnv({ ...validConfig, WEB_APP_URL: "https://kudos-cards.co.uk/" }).WEB_APP_URL,
    ).toBe("https://kudos-cards.co.uk");
    expect(
      validateEnv({ ...validConfig, WEB_APP_URL: "https://kudos-cards.co.uk///" }).WEB_APP_URL,
    ).toBe("https://kudos-cards.co.uk");
  });

  it("leaves a bare origin alone", () => {
    expect(
      validateEnv({ ...validConfig, WEB_APP_URL: "https://kudos-cards.co.uk" }).WEB_APP_URL,
    ).toBe("https://kudos-cards.co.uk");
  });

  it("still refuses a non-http scheme once the slash is gone", () => {
    expect(() =>
      validateEnv({ ...validConfig, WEB_APP_URL: "ftp://kudos-cards.co.uk/" }),
    ).toThrow();
  });
});
