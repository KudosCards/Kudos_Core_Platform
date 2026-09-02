import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_HTTP_TIMEOUT_MS } from "../common/http-request";
import { BREVO_EMAIL_TIMEOUT_MS, HttpBrevoEmailClient } from "./http-brevo-email.client";

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
