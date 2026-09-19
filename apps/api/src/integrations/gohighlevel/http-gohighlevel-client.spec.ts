import {
  GOHIGHLEVEL_MAX_PAGES,
  GOHIGHLEVEL_PAGE_SIZE,
  HttpGoHighLevelClient,
} from "./http-gohighlevel-client";

function contactsPage(count: number, nextPageUrl: string | null): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () =>
      Promise.resolve({
        contacts: Array.from({ length: count }, (_, i) => ({ id: `c${i}` })),
        meta: { nextPageUrl },
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

describe("HttpGoHighLevelClient.fetchContacts", () => {
  let fetchSpy: jest.SpyInstance;
  const client = new HttpGoHighLevelClient("id", "secret", "https://kudos.test/callback");

  afterEach(() => fetchSpy?.mockRestore());

  it("follows the cursor to the end and reports the import complete", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(contactsPage(GOHIGHLEVEL_PAGE_SIZE, "https://ghl.test/next"))
      .mockResolvedValueOnce(contactsPage(7, null));

    const result = await client.fetchContacts("token", "loc-1");

    expect(result.contacts).toHaveLength(GOHIGHLEVEL_PAGE_SIZE + 7);
    expect(result.truncated).toBe(false);
  });

  it("says so when the safety cap stops it with a cursor still outstanding", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(contactsPage(GOHIGHLEVEL_PAGE_SIZE, "https://ghl.test/next")),
      );

    const result = await client.fetchContacts("token", "loc-1");

    expect(fetchSpy).toHaveBeenCalledTimes(GOHIGHLEVEL_MAX_PAGES);
    expect(result.contacts).toHaveLength(GOHIGHLEVEL_MAX_PAGES * GOHIGHLEVEL_PAGE_SIZE);
    expect(result.truncated).toBe(true);
  });

  it("is not truncated when an empty page ends the run at the cap", async () => {
    let call = 0;
    fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(() => {
      call += 1;
      return Promise.resolve(
        call < GOHIGHLEVEL_MAX_PAGES
          ? contactsPage(GOHIGHLEVEL_PAGE_SIZE, "https://ghl.test/next")
          : contactsPage(0, "https://ghl.test/next"),
      );
    });

    const result = await client.fetchContacts("token", "loc-1");

    // An empty page is GoHighLevel's real end-of-list, cursor or not.
    expect(result.truncated).toBe(false);
  });

  it("gives every request a deadline", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(contactsPage(1, null));

    await client.fetchContacts("token", "loc-1");

    expect(initOf(fetchSpy).signal).toBeInstanceOf(AbortSignal);
  });

  /**
   * The reason the upstream gave is the whole point of the error. A GoHighLevel
   * connection failed nightly for five weeks saying only "rejected the access
   * token" while the real cause — a Marketplace app sitting Disapproved — sat
   * unread in the response body. See ADR 0212.
   */
  describe("says what GoHighLevel said", () => {
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
          errorResponse(401, '{"message":"This app is not authorised for this location"}'),
        );

      await expect(client.fetchContacts("token", "loc-1")).rejects.toThrow(
        /not authorised for this location/i,
      );
    });

    it("still says which of ours failed, so the line reads on its own", async () => {
      fetchSpy = jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(errorResponse(401, '{"message":"app not live"}'));

      await expect(client.fetchContacts("token", "loc-1")).rejects.toThrow(
        /LeadConnector rejected the access token/,
      );
    });

    it("carries the reason on a non-401 failure too", async () => {
      fetchSpy = jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(errorResponse(403, '{"message":"contacts.readonly scope missing"}'));

      await expect(client.fetchContacts("token", "loc-1")).rejects.toThrow(
        /contacts\.readonly scope missing/,
      );
    });

    it("carries the reason when the authorization is refused", async () => {
      fetchSpy = jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(errorResponse(400, '{"message":"invalid_grant: code expired"}'));

      await expect(client.exchangeCode("code")).rejects.toThrow(/code expired/);
    });

    it("never echoes the access token back into the message", async () => {
      // If the upstream quotes what we sent, that must not reach the customer's
      // integrations page or the stored status.
      const token = "ghl-access-token-abcdefghijklmnop";
      fetchSpy = jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(errorResponse(401, `{"message":"Bad token ${token} supplied"}`));

      await expect(client.fetchContacts(token, "loc-1")).rejects.toThrow(/\[redacted\]/);
      await expect(client.fetchContacts(token, "loc-1")).rejects.not.toThrow(new RegExp(token));
    });

    it("falls back to the bare summary when there is no body to quote", async () => {
      fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(errorResponse(401, ""));

      await expect(client.fetchContacts("token", "loc-1")).rejects.toThrow(
        /^LeadConnector rejected the access token$/,
      );
    });
  });

  it("retries a rate-limited page rather than failing the whole sync", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: { get: () => null },
        json: () => Promise.resolve({}),
      } as unknown as Response)
      .mockResolvedValueOnce(contactsPage(2, null));

    const result = await client.fetchContacts("token", "loc-1");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.contacts).toHaveLength(2);
  });
});

/**
 * The private-token check. Its job is to separate three outcomes the customer
 * cannot tell apart from a stored connection: the token is wrong, the
 * sub-account is wrong, or LeadConnector is down.
 */
describe("HttpGoHighLevelClient.verifyToken", () => {
  const client = new HttpGoHighLevelClient("id", "secret", "https://redirect.test");
  const TOKEN = "pit-live-token-0123456789";
  let fetchSpy: jest.SpyInstance;

  afterEach(() => fetchSpy?.mockRestore());

  function errorResponse(status: number, body: string): Response {
    return {
      ok: false,
      status,
      headers: { get: () => null },
      json: () => Promise.reject(new SyntaxError("not json")),
      text: () => Promise.resolve(body),
    } as unknown as Response;
  }

  it("asks for one contact in the named sub-account, with both headers", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(contactsPage(1, null));

    await client.verifyToken(TOKEN, "loc-abc-123");

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("locationId=loc-abc-123");
    expect(url).toContain("limit=1");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    // Every v2 call carries the dated version header; without it the API 4xxs.
    expect(headers.Version).toBe("2021-07-28");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("passes a sub-account that has no contacts in it yet", async () => {
    // The question is whether the token can read this sub-account, not whether
    // anyone is in it. A new sub-account would otherwise be unconnectable.
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(contactsPage(0, null));

    await expect(client.verifyToken(TOKEN, "loc-abc-123")).resolves.toBeUndefined();
  });

  it.each([401, 403])("reports %i as a rejected token", async (status) => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(errorResponse(status, '{"message":"Location is not active"}'));

    await expect(client.verifyToken(TOKEN, "loc-abc-123")).rejects.toThrow(
      /rejected the access token/,
    );
  });

  it("carries LeadConnector's own words through, so the reason is actionable", async () => {
    // "Location is not active" is a statement about the sub-account, not the
    // credential — and it is the difference between reconnecting for ever and
    // fixing the sub-account. See ADR 0212.
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(errorResponse(401, '{"message":"Location is not active"}'));

    await expect(client.verifyToken(TOKEN, "loc-abc-123")).rejects.toThrow(
      /Location is not active/,
    );
  });

  it("never lets the token into the message it stores", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(errorResponse(401, `{"message":"bad token ${TOKEN}"}`));

    await expect(client.verifyToken(TOKEN, "loc")).rejects.toThrow(/\[redacted\]/);
    await expect(client.verifyToken(TOKEN, "loc")).rejects.not.toThrow(new RegExp(TOKEN));
  });

  it("reports an upstream failure as a bad gateway, not a bad token", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(errorResponse(400, "nope"));

    await expect(client.verifyToken(TOKEN, "loc")).rejects.toThrow(
      /contacts request failed \(400\)/,
    );
  });
});
