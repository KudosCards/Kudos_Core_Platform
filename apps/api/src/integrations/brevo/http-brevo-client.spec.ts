import { BREVO_MAX_PAGES, BREVO_PAGE_SIZE, HttpBrevoClient } from "./http-brevo-client";

function contactsPage(count: number, total: number): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () =>
      Promise.resolve({
        contacts: Array.from({ length: count }, (_, i) => ({
          id: i,
          email: `c${i}@example.com`,
          attributes: {},
        })),
        count: total,
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

describe("HttpBrevoClient.fetchContacts", () => {
  let fetchSpy: jest.SpyInstance;
  const client = new HttpBrevoClient();

  afterEach(() => fetchSpy?.mockRestore());

  it("reads every page and reports the import complete", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(contactsPage(BREVO_PAGE_SIZE, BREVO_PAGE_SIZE + 3))
      .mockResolvedValueOnce(contactsPage(3, BREVO_PAGE_SIZE + 3));

    const result = await client.fetchContacts("key");

    expect(result.contacts).toHaveLength(BREVO_PAGE_SIZE + 3);
    expect(result.truncated).toBe(false);
  });

  it("says so when the safety cap stops it with more still to read", async () => {
    const total = (BREVO_MAX_PAGES + 5) * BREVO_PAGE_SIZE;
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(contactsPage(BREVO_PAGE_SIZE, total)));

    const result = await client.fetchContacts("key");

    expect(fetchSpy).toHaveBeenCalledTimes(BREVO_MAX_PAGES);
    expect(result.contacts).toHaveLength(BREVO_MAX_PAGES * BREVO_PAGE_SIZE);
    expect(result.truncated).toBe(true);
  });

  it("is not truncated when the count is reached exactly on the last allowed page", async () => {
    const total = BREVO_MAX_PAGES * BREVO_PAGE_SIZE;
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(contactsPage(BREVO_PAGE_SIZE, total)));

    const result = await client.fetchContacts("key");

    // Every contact Brevo says exists did arrive — the cap was reached, but
    // nothing was left behind, so this is not a partial import.
    expect(result.contacts).toHaveLength(total);
    expect(result.truncated).toBe(false);
  });

  it("gives every request a deadline", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(contactsPage(1, 1));

    await client.fetchContacts("key");
    await client.verifyKey("key");

    for (let i = 0; i < (fetchSpy.mock.calls as unknown[]).length; i += 1) {
      expect(initOf(fetchSpy, i).signal).toBeInstanceOf(AbortSignal);
    }
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
      .mockResolvedValueOnce(contactsPage(2, 2));

    const result = await client.fetchContacts("key");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.contacts).toHaveLength(2);
  });
});
