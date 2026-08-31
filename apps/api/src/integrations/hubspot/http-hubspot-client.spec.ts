import { HttpHubSpotClient, HUBSPOT_MAX_PAGES, HUBSPOT_PAGE_SIZE } from "./http-hubspot-client";

function contactsPage(count: number, after: string | null): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () =>
      Promise.resolve({
        results: Array.from({ length: count }, (_, i) => ({
          id: `c${i}`,
          properties: { email: `c${i}@example.com` },
        })),
        ...(after ? { paging: { next: { after } } } : {}),
      }),
    text: () => Promise.resolve(""),
  } as unknown as Response;
}

/** The RequestInit a fetch call was made with — every call site must be handed
 * a signal, which is what these assertions check. */
function initOf(spy: jest.SpyInstance, index = 0): RequestInit {
  const call = spy.mock.calls.at(index) as [string, RequestInit] | undefined;
  if (!call) throw new Error("fetch was not called");
  return call[1];
}

describe("HttpHubSpotClient.fetchContacts", () => {
  let fetchSpy: jest.SpyInstance;
  const client = new HttpHubSpotClient("id", "secret", "https://kudos.test/callback");

  afterEach(() => fetchSpy?.mockRestore());

  it("reads every page and reports the import complete", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(contactsPage(HUBSPOT_PAGE_SIZE, "cursor-2"))
      .mockResolvedValueOnce(contactsPage(4, null));

    const result = await client.fetchContacts("token", ["email"]);

    expect(result.contacts).toHaveLength(HUBSPOT_PAGE_SIZE + 4);
    expect(result.truncated).toBe(false);
  });

  it("says so when the safety cap stops it with more still to read", async () => {
    // A portal bigger than the cap: HubSpot keeps handing back a cursor.
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(contactsPage(HUBSPOT_PAGE_SIZE, "more")));

    const result = await client.fetchContacts("token", ["email"]);

    expect(fetchSpy).toHaveBeenCalledTimes(HUBSPOT_MAX_PAGES);
    expect(result.contacts).toHaveLength(HUBSPOT_MAX_PAGES * HUBSPOT_PAGE_SIZE);
    // The half of the import that never arrived has to be visible to the caller.
    expect(result.truncated).toBe(true);
  });

  it("is not truncated when the last page fills exactly and the cursor runs out", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(contactsPage(HUBSPOT_PAGE_SIZE, "cursor-2"))
      .mockResolvedValueOnce(contactsPage(HUBSPOT_PAGE_SIZE, null));

    const result = await client.fetchContacts("token", ["email"]);

    expect(result.truncated).toBe(false);
  });

  it("gives every contacts request a deadline", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(contactsPage(1, null));

    await client.fetchContacts("token", ["email"]);

    expect(initOf(fetchSpy).signal).toBeInstanceOf(AbortSignal);
  });

  it("gives the token request a deadline too", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () => Promise.resolve({ access_token: "a", refresh_token: "r", expires_in: 1800 }),
    } as unknown as Response);

    await client.exchangeCode("code");

    expect(initOf(fetchSpy).signal).toBeInstanceOf(AbortSignal);
  });

  /**
   * The reason the upstream gave is the whole point of the error — see ADR 0212
   * for the five weeks that cost us on the GoHighLevel side.
   */
  describe("says what HubSpot said", () => {
    function errorResponse(status: number, body: string): Response {
      return {
        ok: false,
        status,
        headers: { get: () => null },
        text: () => Promise.resolve(body),
        json: () => Promise.resolve({}),
      } as unknown as Response;
    }

    it("carries the upstream reason on a rejected contacts call", async () => {
      fetchSpy = jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          errorResponse(
            401,
            '{"message":"This app has not been granted crm.objects.contacts.read"}',
          ),
        );

      await expect(client.fetchContacts("token", ["email"])).rejects.toThrow(
        /crm\.objects\.contacts\.read/,
      );
    });

    it("carries the reason when the authorization is refused", async () => {
      fetchSpy = jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(errorResponse(400, '{"message":"authorization code expired"}'));

      await expect(client.exchangeCode("code")).rejects.toThrow(/authorization code expired/);
    });

    it("never echoes the access token back into the message", async () => {
      const token = "hubspot-access-token-abcdefghij";
      fetchSpy = jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(errorResponse(401, `{"message":"Bad token ${token}"}`));

      await expect(client.fetchContacts(token, ["email"])).rejects.toThrow(/\[redacted\]/);
    });

    it("falls back to the bare summary when there is no body to quote", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(errorResponse(401, ""));

      await expect(client.fetchContacts("token", ["email"])).rejects.toThrow(
        /^HubSpot rejected the access token$/,
      );
    });
  });

  it("retries a rate-limited contacts page rather than failing the whole sync", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: () => null },
        json: () => Promise.resolve({}),
      } as unknown as Response)
      .mockResolvedValueOnce(contactsPage(2, null));

    const result = await client.fetchContacts("token", ["email"]);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.contacts).toHaveLength(2);
  });
});
