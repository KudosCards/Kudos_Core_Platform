import { BadGatewayException, UnauthorizedException } from "@nestjs/common";
import { CONTACTS_FETCH_BUDGET_MS } from "../../common/fetch-budget";
import { CLEANCLOUD_BASE_URL, HttpCleanCloudClient } from "./http-cleancloud-client";
import { customerWindows } from "./cleancloud-windows";

const NOW = new Date("2026-09-18T11:30:00Z");
const TOKEN = "cc-live-token-0123456789";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function textResponse(text: string, status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.reject(new SyntaxError("Unexpected token")),
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

function bodyOf(spy: jest.SpyInstance, index = 0): Record<string, unknown> {
  const call = spy.mock.calls.at(index) as [string, { body?: string }] | undefined;
  if (!call) throw new Error("fetch was not called");
  return JSON.parse(call[1].body ?? "{}") as Record<string, unknown>;
}

describe("HttpCleanCloudClient", () => {
  const client = new HttpCleanCloudClient();
  let fetchSpy: jest.SpyInstance;

  afterEach(() => {
    fetchSpy?.mockRestore();
    jest.restoreAllMocks();
  });

  it("sends the token in the JSON body, not a header", () => {
    // CleanCloud authenticates on `api_token` in the body. A header would be
    // accepted by nothing and rejected with a message about a missing token.
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}));

    return client.verifyKey(TOKEN).then(() => {
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${CLEANCLOUD_BASE_URL}/getCustomer`);
      expect(init.method).toBe("POST");
      expect(JSON.stringify(init.headers)).not.toContain(TOKEN);
      expect(bodyOf(fetchSpy)).toMatchObject({ api_token: TOKEN, excludeDeactivated: 1 });
      // httpRequest owns the deadline; every call site must be handed a signal.
      expect(init.signal).toBeInstanceOf(AbortSignal);
    });
  });

  it("checks a token with exactly one short request", async () => {
    // The point of verifyKey: separate "wrong token" from "CleanCloud is down"
    // before committing to a decade of requests.
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}));

    await client.verifyKey(TOKEN);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchSpy).dateFrom).toBe(bodyOf(fetchSpy).dateTo);
  });

  it("walks the whole history newest window first", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ Customers: [] }));

    const result = await client.fetchCustomers(TOKEN, NOW);

    const expected = customerWindows(NOW);
    expect(fetchSpy).toHaveBeenCalledTimes(expected.windows.length);
    expect(bodyOf(fetchSpy, 0).dateTo).toBe("2026-09-18");
    expect(bodyOf(fetchSpy, -1).dateFrom).toBe("2016-09-18");
    expect(result.truncated).toBe(false);
  });

  it("gathers customers from every window", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ Customers: [{ customerID: "1" }] }))
      .mockResolvedValue(jsonResponse({ Customers: [{ customerID: "2" }] }));

    const result = await client.fetchCustomers(TOKEN, NOW);

    expect(result.contacts.length).toBe(customerWindows(NOW).windows.length);
    expect(result.contacts[0]).toEqual({ customerID: "1" });
  });

  it("says so when the time budget stops it with history still unread", async () => {
    // Newest first is what makes a partial pull useful: the customers who
    // signed up most recently are the ones held.
    const start = Date.now();
    let calls = 0;
    jest.spyOn(Date, "now").mockImplementation(() => {
      calls += 1;
      return calls > 3 ? start + CONTACTS_FETCH_BUDGET_MS : start;
    });
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ Customers: [{ customerID: "1" }] }));

    const result = await client.fetchCustomers(TOKEN, NOW);

    expect(result.truncated).toBe(true);
    expect(fetchSpy.mock.calls.length).toBeLessThan(customerWindows(NOW).windows.length);
    expect(result.contacts.length).toBeGreaterThan(0);
  });

  it.each([401, 403])("reports a rejected token as an auth failure (%i)", async (status) => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(textResponse('{"Error":"Invalid API token"}', status));

    await expect(client.verifyKey(TOKEN)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("never lets the token into the message it stores", async () => {
    // lastSyncStatus is shown on the customer's integrations page.
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(textResponse(`{"Error":"Bad token ${TOKEN}"}`, 401));

    await expect(client.verifyKey(TOKEN)).rejects.toThrow(/\[redacted\]/);
    await expect(client.verifyKey(TOKEN)).rejects.not.toThrow(new RegExp(TOKEN));
  });

  it("reports an upstream failure as a bad gateway", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(textResponse("nope", 400));

    await expect(client.verifyKey(TOKEN)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it("does not surface a body that is not JSON as a parser crash", async () => {
    // An HTML error page from a proxy would otherwise arrive as a raw
    // SyntaxError with no mention of CleanCloud in it.
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(textResponse("<html>Gateway Timeout</html>", 200));

    await expect(client.verifyKey(TOKEN)).rejects.toThrow(/CleanCloud returned a response/);
  });
});
