import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_HTTP_TIMEOUT_MS } from "../common/http-request";
import {
  BREVO_EMAIL_TIMEOUT_MS,
  HttpBrevoEmailClient,
  plainTextFrom,
} from "./http-brevo-email.client";

function fakeResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(""),
    json: () => Promise.resolve({}),
  } as unknown as Response;
}

/**
 * Sending is not safe to repeat. Brevo may have accepted and queued a message
 * and then failed to answer us; a retry puts a second copy in the recipient's
 * inbox. So this call gets a deadline but exactly one attempt. See ADR 0209.
 */
describe("HttpBrevoEmailClient", () => {
  let fetchSpy: jest.SpyInstance;
  const client = new HttpBrevoEmailClient("key", "hello@kudoscards.test", "Kudos Cards");

  afterEach(() => fetchSpy?.mockRestore());

  const input = { to: "ada@example.com", subject: "Hello", html: "<p>Hi</p>" };

  it("makes exactly one attempt on a 503 — a retry would send twice", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(503));

    await expect(client.sendTransactional(input)).rejects.toThrow(/503/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not retry a rate-limited send either", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(429));

    await expect(client.sendTransactional(input)).rejects.toThrow(/429/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("gives the send a deadline", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(201));

    await client.sendTransactional(input);

    const call = fetchSpy.mock.calls.at(-1) as [string, RequestInit];
    expect(call[1].signal).toBeInstanceOf(AbortSignal);
  });
});

/**
 * The deadline itself, which the "gives the send a deadline" case above proves
 * exists but not how long it is.
 *
 * It has to be longer than the default. The send opts out of retries because
 * Brevo may have accepted a message and then failed to answer, and trying again
 * puts a second copy in someone's inbox — and an abort carries exactly the same
 * ambiguity. At 15 seconds the abort was the likelier of the two: a
 * slow-but-successful send throws, the caller records nothing, and the reminder
 * digest goes out again tomorrow. See ADR 0231.
 *
 * These pin the number rather than the behaviour, knowingly. There is no seam
 * for the behaviour: `AbortSignal.timeout` does not expose its duration, and
 * jest's fake timers do not drive it (measured, not assumed — the abort simply
 * never fires in fake time), so a "a slow send is not aborted" test would pass
 * against a one-millisecond deadline just as happily.
 */
describe("the Brevo send deadline", () => {
  it("is longer than the default, because this call cannot be retried", () => {
    expect(BREVO_EMAIL_TIMEOUT_MS).toBeGreaterThan(DEFAULT_HTTP_TIMEOUT_MS);
  });

  it("still bounds the call — a hung upstream must not hold a caller for ever", () => {
    expect(BREVO_EMAIL_TIMEOUT_MS).toBeLessThanOrEqual(120_000);
  });

  it("is the one actually handed to the request", () => {
    const source = readFileSync(join(__dirname, "http-brevo-email.client.ts"), "utf8");
    expect(source).toContain("timeoutMs: BREVO_EMAIL_TIMEOUT_MS");
    // And the no-retry decision this exists to complement is still in force.
    expect(source).not.toContain("maxAttempts");
  });
});

describe("an HTML email with no configured sender", () => {
  /**
   * Brevo rejects a non-template send that carries no sender, so this used to
   * leave the API with a 400 it could not explain and Brevo's dashboard with no
   * record at all — the send was never accepted, so there was nothing to find
   * when somebody went looking for the missing password reset. See ADR 0267.
   */
  let fetchSpy: jest.SpyInstance;
  afterEach(() => fetchSpy?.mockRestore());

  it("is refused here rather than sent and rejected", async () => {
    const senderless = new HttpBrevoEmailClient("key", undefined, "Kudos Cards");
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(200));

    await expect(
      senderless.sendTransactional({ to: "ada@example.com", subject: "Reset", html: "<p>Hi</p>" }),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still sends a template, which carries its own sender", async () => {
    const senderless = new HttpBrevoEmailClient("key", undefined, "Kudos Cards");
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(200));

    await senderless.sendTransactional({ to: "ada@example.com", subject: "Hi", templateId: 7 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

/**
 * Brevo scopes unsubscribes and spam complaints to a **sender**, while hard
 * bounces are account-wide. Sending everything from one address therefore lets
 * an unsubscribe from a newsletter suppress that person's password reset —
 * which is on our blocklist today. See ADR 0269.
 */
describe("the sender for mail somebody is locked out without", () => {
  let fetchSpy: jest.SpyInstance;
  afterEach(() => fetchSpy?.mockRestore());

  const reset = { to: "ada@example.com", subject: "Reset", html: "<p>Hi</p>" };

  const sentFrom = (): { email: string; name: string } => {
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(typeof init.body).toBe("string");
    return (JSON.parse(init.body as string) as { sender: { email: string; name: string } }).sender;
  };

  const split = new HttpBrevoEmailClient(
    "key",
    "hello@kudoscards.test",
    "Kudos Cards",
    "account@kudoscards.test",
    "Kudos Cards Security",
  );

  it("uses the account sender for an account email", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(200));

    await split.sendTransactional({ ...reset, sender: "account" });

    expect(sentFrom()).toEqual({ email: "account@kudoscards.test", name: "Kudos Cards Security" });
  });

  it("leaves every other email on the ordinary sender", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(200));

    await split.sendTransactional(reset);

    expect(sentFrom()).toEqual({ email: "hello@kudoscards.test", name: "Kudos Cards" });
  });

  // Until a second sender is verified in Brevo there is nothing to switch to,
  // and an unverified address would have Brevo reject the whole request.
  it("falls back to the ordinary sender when no account sender is configured", async () => {
    const unsplit = new HttpBrevoEmailClient("key", "hello@kudoscards.test", "Kudos Cards");
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(200));

    await unsplit.sendTransactional({ ...reset, sender: "account" });

    expect(sentFrom()).toEqual({ email: "hello@kudoscards.test", name: "Kudos Cards" });
  });

  it("keeps the ordinary name when only an account address is configured", async () => {
    const namelessAccount = new HttpBrevoEmailClient(
      "key",
      "hello@kudoscards.test",
      "Kudos Cards",
      "account@kudoscards.test",
    );
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(200));

    await namelessAccount.sendTransactional({ ...reset, sender: "account" });

    expect(sentFrom()).toEqual({ email: "account@kudoscards.test", name: "Kudos Cards" });
  });

  // An account sender alone is still a sender: a non-template send is only
  // undeliverable when there is no address at all.
  it("sends an account email when only the account sender is configured", async () => {
    const accountOnly = new HttpBrevoEmailClient(
      "key",
      undefined,
      "Kudos Cards",
      "account@kudoscards.test",
    );
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(200));

    await accountOnly.sendTransactional({ ...reset, sender: "account" });

    expect(sentFrom()).toEqual({ email: "account@kudoscards.test", name: "Kudos Cards" });
  });
});

describe("the plain-text part", () => {
  /**
   * Brevo does not synthesise one. A single-part HTML-only message carrying a
   * remote image and a long tokenised link is the shape filters score down —
   * which matters most for the auth emails people report as never arriving.
   */
  let fetchSpy: jest.SpyInstance;
  afterEach(() => fetchSpy?.mockRestore());

  it("goes alongside the HTML on every fallback send", async () => {
    const client = new HttpBrevoEmailClient("key", "hello@kudoscards.test", "Kudos Cards");
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(200));

    await client.sendTransactional({
      to: "ada@example.com",
      subject: "Reset your password",
      html: '<p>Hello</p><a href="https://kudos-cards.co.uk/reset?token_hash=abc">Choose a new password</a>',
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(typeof init.body).toBe("string");
    const body = JSON.parse(init.body as string) as {
      textContent: string;
      htmlContent: string;
    };
    expect(body.htmlContent).toContain("<p>Hello</p>");
    expect(body.textContent).toContain("Hello");
    // The link has to survive: a reset email without its URL is useless.
    expect(body.textContent).toContain("https://kudos-cards.co.uk/reset?token_hash=abc");
  });

  it("keeps the link even when the label is the URL itself", () => {
    const text = plainTextFrom('<a href="https://x.test/a">https://x.test/a</a>', "Subject");
    expect(text).toBe("https://x.test/a");
  });

  it("drops markup and undoes entities rather than printing them", () => {
    const text = plainTextFrom(
      "<style>p{}</style><p>Tom &amp; Jerry</p><br/><p>Next</p>",
      "Subject",
    );
    expect(text).not.toContain("<");
    expect(text).not.toContain("&amp;");
    expect(text).toContain("Tom & Jerry");
    expect(text).toContain("Next");
  });

  it("falls back to the subject rather than sending an empty part", () => {
    expect(plainTextFrom("<img src='x'>", "Reset your password")).toBe("Reset your password");
  });
});
