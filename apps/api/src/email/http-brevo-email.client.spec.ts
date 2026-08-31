import { HttpBrevoEmailClient } from "./http-brevo-email.client";

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
