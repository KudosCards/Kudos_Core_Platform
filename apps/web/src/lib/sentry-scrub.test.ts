import { scrubEvent, scrubBreadcrumb, redactWebUrl } from "./sentry-scrub";

/**
 * Every public page in this product that takes a secret takes it in the URL —
 * there is no session yet, so the URL is the credential. Sentry records the URL
 * on every event and every navigation breadcrumb, which puts those credentials
 * in a second system with a second set of readers. The API has scrubbed its own
 * since ADR 0187; the web had nothing at all. See ADR 0228.
 */
describe("redactWebUrl", () => {
  it("redacts an invite token from the path", () => {
    expect(redactWebUrl("https://app.kudos.test/invite/pQ7abc")).toBe(
      "https://app.kudos.test/invite/[redacted]",
    );
  });

  it("redacts a returned-to-sender token but keeps the route shape", () => {
    expect(redactWebUrl("https://app.kudos.test/rts/tok123/address?step=2")).toBe(
      "https://app.kudos.test/rts/[redacted]/address?step=2",
    );
  });

  it("redacts a claim token in the query string", () => {
    expect(redactWebUrl("https://app.kudos.test/gift/claim?token=tok123")).toBe(
      "https://app.kudos.test/gift/claim?token=[redacted]",
    );
  });

  it("redacts a Supabase one-time link, which grants a whole session", () => {
    expect(
      redactWebUrl("https://app.kudos.test/auth/confirm?token_hash=abc123&type=recovery"),
    ).toBe("https://app.kudos.test/auth/confirm?token_hash=[redacted]&type=recovery");
  });

  it("redacts an implicit-flow access token out of the fragment", () => {
    // Supabase's implicit flow puts the session in the hash, and the browser
    // SDK reports `location.href` — hash included.
    expect(
      redactWebUrl("https://app.kudos.test/auth/confirm#access_token=abc&refresh_token=def"),
    ).toBe("https://app.kudos.test/auth/confirm#access_token=[redacted]&refresh_token=[redacted]");
  });

  it("leaves an ordinary URL alone", () => {
    expect(redactWebUrl("https://app.kudos.test/recipients?page=2")).toBe(
      "https://app.kudos.test/recipients?page=2",
    );
  });

  it("redacts a relative URL too", () => {
    expect(redactWebUrl("/invite/pQ7abc")).toBe("/invite/[redacted]");
  });

  it("returns a URL it cannot parse unchanged rather than throwing", () => {
    expect(redactWebUrl("not a url at all")).toBe("not a url at all");
  });
});

describe("the Sentry hooks", () => {
  it("scrubs the event's request URL", () => {
    // `type: undefined` is what marks a Sentry event as an *error* event
    // rather than a transaction; the SDK's own type requires it to be present.
    const event = { type: undefined, request: { url: "https://app.kudos.test/invite/pQ7abc" } };
    expect(scrubEvent(event).request?.url).toBe("https://app.kudos.test/invite/[redacted]");
  });

  it("scrubs a navigation breadcrumb's from and to", () => {
    const crumb = {
      category: "navigation",
      data: { from: "/invite/pQ7abc", to: "/gift/claim?token=tok123" },
    };
    expect(scrubBreadcrumb(crumb).data).toEqual({
      from: "/invite/[redacted]",
      to: "/gift/claim?token=[redacted]",
    });
  });

  it("scrubs a fetch breadcrumb's url", () => {
    const crumb = { category: "fetch", data: { url: "https://api.kudos.test/invites/tok/accept" } };
    expect(scrubBreadcrumb(crumb).data?.url).toBe(
      "https://api.kudos.test/invites/[redacted]/accept",
    );
  });

  it("leaves a breadcrumb with no URL data alone", () => {
    const crumb = { category: "console", message: "hello" };
    expect(scrubBreadcrumb(crumb)).toEqual(crumb);
  });
});
