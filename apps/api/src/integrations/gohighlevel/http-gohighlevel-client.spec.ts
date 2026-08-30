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
