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
    expect(validateEnv({ ...validConfig, EMAIL_FROM_NAME: "" }).EMAIL_FROM_NAME).toBe("Kudos Cards");
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
