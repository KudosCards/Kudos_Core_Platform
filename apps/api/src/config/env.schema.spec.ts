import { validateEnv } from "./env.schema";

const validConfig = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
  DIRECT_URL: "postgresql://user:pass@localhost:5432/db",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_JWT_SECRET: "secret",
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
});
