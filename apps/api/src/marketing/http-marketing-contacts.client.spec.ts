import { HttpMarketingContactsClient } from "./http-marketing-contacts.client";

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
 * The opposite call to the transactional send: `updateEnabled: true` makes this
 * an upsert keyed on email, so repeating a call Brevo already applied lands on
 * the same contact. That makes it one of the few POSTs safe to retry, and a
 * signup shouldn't lose its marketing-list membership to a momentary 429.
 * See ADR 0209.
 */
describe("HttpMarketingContactsClient", () => {
  let fetchSpy: jest.SpyInstance;
  const client = new HttpMarketingContactsClient("key");

  afterEach(() => fetchSpy?.mockRestore());

  const input = { email: "ada@example.com", firstName: "Ada", listId: 7 };

  it("retries a rate-limited upsert and succeeds", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fakeResponse(429))
      .mockResolvedValueOnce(fakeResponse(201));

    await expect(client.upsertContact(input)).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("gives up after a bounded number of attempts rather than hammering Brevo", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(503));

    await expect(client.upsertContact(input)).rejects.toThrow(/503/);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("does not retry a rejected key — that will fail identically", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(401));

    await expect(client.upsertContact(input)).rejects.toThrow(/401/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("gives the upsert a deadline", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(201));

    await client.upsertContact(input);

    const call = fetchSpy.mock.calls.at(-1) as [string, RequestInit];
    expect(call[1].signal).toBeInstanceOf(AbortSignal);
  });
});
