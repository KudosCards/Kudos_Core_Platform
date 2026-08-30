import {
  DEFAULT_HTTP_TIMEOUT_MS,
  MAX_RETRY_DELAY_MS,
  httpRequest,
  isRetryableStatus,
  retryDelayMs,
} from "./http-request";

/** A Response stand-in: enough for the helper, which reads `status`, `headers`
 * and (on a discarded retry) `body`. */
function fakeResponse(status: number, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
  } as unknown as Response;
}

/** The RequestInit a fetch call was made with — every call site must be handed
 * a signal, which is what these assertions check. */
function initOf(spy: jest.SpyInstance, index = 0): RequestInit {
  const call = spy.mock.calls.at(index) as [string, RequestInit] | undefined;
  if (!call) throw new Error("fetch was not called");
  return call[1];
}

describe("isRetryableStatus", () => {
  it("retries rate limiting and upstream failure, nothing else", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    // A 4xx will fail again identically — retrying only delays the error.
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(200)).toBe(false);
  });
});

describe("retryDelayMs", () => {
  it("backs off exponentially from the base delay when there is no instruction", () => {
    expect(retryDelayMs(1, null, 500)).toBe(500);
    expect(retryDelayMs(2, null, 500)).toBe(1_000);
    expect(retryDelayMs(3, null, 500)).toBe(2_000);
  });

  it("honours Retry-After in delta-seconds", () => {
    expect(retryDelayMs(1, "7", 500)).toBe(7_000);
    // The header wins over backoff even when it asks for less than the base.
    expect(retryDelayMs(3, "1", 500)).toBe(1_000);
  });

  it("honours Retry-After as an HTTP date", () => {
    const now = Date.parse("2026-08-30T12:00:00.000Z");
    expect(retryDelayMs(1, "Sun, 30 Aug 2026 12:00:20 GMT", 500, now)).toBe(20_000);
    // A date already past means "come back now", not a negative wait.
    expect(retryDelayMs(1, "Sun, 30 Aug 2026 11:59:00 GMT", 500, now)).toBe(0);
  });

  it("ignores an unparseable Retry-After and falls back to backoff", () => {
    expect(retryDelayMs(2, "soon please", 500)).toBe(1_000);
    expect(retryDelayMs(2, "", 500)).toBe(1_000);
  });

  it("never waits longer than the cap, however long the upstream asks for", () => {
    expect(retryDelayMs(1, "3600", 500)).toBe(MAX_RETRY_DELAY_MS);
    expect(retryDelayMs(20, null, 500)).toBe(MAX_RETRY_DELAY_MS);
  });
});

describe("httpRequest", () => {
  let fetchSpy: jest.SpyInstance;

  afterEach(() => {
    fetchSpy?.mockRestore();
    jest.useRealTimers();
  });

  it("gives every attempt a deadline, so a hung upstream cannot hold the caller open", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(200));

    await httpRequest("https://upstream.test/thing", { method: "GET" });

    const init = initOf(fetchSpy);
    expect(init.method).toBe("GET");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
  });

  it("aborts an attempt that outruns the timeout", async () => {
    // The signal the helper passes is what actually cancels the request; assert
    // it fires rather than trusting that it was merely handed over.
    fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason as Error));
      });
    });

    await expect(
      httpRequest("https://slow.test/thing", {}, { timeoutMs: 20 }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("does not retry by default — one attempt, even on a 503", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(503));

    const response = await httpRequest("https://upstream.test/thing");

    expect(response.status).toBe(503);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 and returns the eventual success", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fakeResponse(429))
      .mockResolvedValueOnce(fakeResponse(500))
      .mockResolvedValueOnce(fakeResponse(200));

    const response = await httpRequest(
      "https://upstream.test/thing",
      {},
      { maxAttempts: 3, baseDelayMs: 0 },
    );

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("waits as long as Retry-After asks before trying again", async () => {
    jest.useFakeTimers();
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(fakeResponse(429, { "retry-after": "5" }))
      .mockResolvedValueOnce(fakeResponse(200));

    const pending = httpRequest("https://upstream.test/thing", {}, { maxAttempts: 2 });

    await jest.advanceTimersByTimeAsync(4_999);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({ status: 200 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("gives back the last response when the retries run out", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(503));

    const response = await httpRequest(
      "https://upstream.test/thing",
      {},
      { maxAttempts: 3, baseDelayMs: 0 },
    );

    // The call site's own !response.ok handling still gets to run.
    expect(response.status).toBe(503);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("retries a transport failure, and rethrows it once out of attempts", async () => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(fakeResponse(200));

    await expect(
      httpRequest("https://upstream.test/thing", {}, { maxAttempts: 2, baseDelayMs: 0 }),
    ).resolves.toMatchObject({ status: 200 });

    fetchSpy.mockReset();
    fetchSpy.mockRejectedValue(new Error("ECONNRESET"));
    await expect(
      httpRequest("https://upstream.test/thing", {}, { maxAttempts: 2, baseDelayMs: 0 }),
    ).rejects.toThrow("ECONNRESET");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("never retries a 4xx — the request is wrong, not the moment", async () => {
    fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue(fakeResponse(401));

    const response = await httpRequest(
      "https://upstream.test/thing",
      {},
      { maxAttempts: 5, baseDelayMs: 0 },
    );

    expect(response.status).toBe(401);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("defaults the deadline rather than leaving a call untimed", () => {
    expect(DEFAULT_HTTP_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
