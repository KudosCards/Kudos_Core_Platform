import type { ConfigService } from "@nestjs/config";
import type { EnvConfig } from "../config/env.schema";
import { CatalogPublisherService } from "./catalog-publisher.service";

/**
 * The publish call is what stops a synced card sitting invisible on the public
 * library for an hour, so the thing worth pinning down is that it never takes
 * the sync down with it: whatever the web app does, `publish()` resolves.
 */

function makeService(env: Partial<EnvConfig>): CatalogPublisherService {
  const config = {
    get: (key: keyof EnvConfig) => env[key],
  } as unknown as ConfigService<EnvConfig, true>;
  return new CatalogPublisherService(config);
}

const CONFIGURED = {
  WEB_APP_URL: "https://kudos-cards.co.uk",
  CATALOG_REVALIDATE_SECRET: "s3cret",
} as Partial<EnvConfig>;

/**
 * A stand-in for a real Response, and the body method is the point: `fetch`
 * resolves on headers while the body is still streaming, so the service drains
 * it. A mock without `text()` would let that drain break in production while
 * the tests stayed green.
 */
function okResponse(body = "<html>cards</html>"): {
  ok: true;
  status: 200;
  text: () => Promise<string>;
} {
  return { ok: true, status: 200, text: () => Promise.resolve(body) };
}

describe("CatalogPublisherService", () => {
  // Typed at creation so `mock.calls` carries real types and the assertions
  // below don't each need a cast.
  const fetchMock: jest.Mock<Promise<unknown>, [string, RequestInit?]> = jest.fn();

  const callUrl = (index: number): string => fetchMock.mock.calls[index]?.[0] ?? "";
  const callInit = (index: number): RequestInit => fetchMock.mock.calls[index]?.[1] ?? {};

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("posts the secret to the web app and reports success", async () => {
    fetchMock.mockResolvedValue(okResponse());

    const result = await makeService(CONFIGURED).publish();

    expect(result.outcome).toBe("published");
    expect(callUrl(0)).toBe("https://kudos-cards.co.uk/api/revalidate-catalog");
    expect(callInit(0).method).toBe("POST");
    const headers = callInit(0).headers as Record<string, string>;
    expect(headers["x-catalog-revalidate-secret"]).toBe("s3cret");
  });

  it("bounds every request with the publish deadline, purge and warms alike", async () => {
    // An AbortSignal exposes no deadline to read back, so watch it being armed:
    // this pins that the publish timeout is the one applied to all three legs,
    // not the longer platform default. See ADR 0209.
    const timeoutSpy = jest.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValue(okResponse());

    await makeService(CONFIGURED).publish();

    expect(timeoutSpy).toHaveBeenCalledTimes(3);
    for (const [ms] of timeoutSpy.mock.calls) {
      expect(ms).toBe(10_000);
    }
    for (let i = 0; i < 3; i += 1) {
      expect(callInit(i).signal).toBeInstanceOf(AbortSignal);
    }
    timeoutSpy.mockRestore();
  });

  it("warms /cards in a second request, after the purge has landed", async () => {
    fetchMock.mockResolvedValue(okResponse());

    await makeService(CONFIGURED).publish();

    // The warm must be its own request: Next applies revalidated tags when the
    // revalidate request finishes, so warming from inside that handler
    // re-caches the very data being dropped and leaves the page a cycle behind.
    // And it takes two of them — the first is served the stale page and only
    // starts the rebuild. Both verified against a running production build.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(callUrl(1)).toBe("https://kudos-cards.co.uk/cards");
    expect(callUrl(2)).toBe("https://kudos-cards.co.uk/cards");
  });

  it("reads each response to the end rather than stopping at the headers", async () => {
    // Not tidiness. `fetch` resolves once the headers arrive while a Next page
    // is still streaming its HTML, so a warm that returned there would move on
    // mid-render — and the second request would measure a rebuild that hadn't
    // finished. Draining is what makes the warm a warm.
    const bodies = [
      jest.fn(() => Promise.resolve("ok")),
      jest.fn(() => Promise.resolve("a")),
      jest.fn(() => Promise.resolve("b")),
    ];
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, text: bodies[0] })
      .mockResolvedValueOnce({ ok: true, status: 200, text: bodies[1] })
      .mockResolvedValueOnce({ ok: true, status: 200, text: bodies[2] });

    await makeService(CONFIGURED).publish();

    for (const body of bodies) {
      expect(body).toHaveBeenCalled();
    }
  });

  it("still reports success when the warm fails — the purge is what matters", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    fetchMock.mockResolvedValueOnce(okResponse()).mockRejectedValueOnce(new Error("timeout"));

    const result = await makeService(CONFIGURED).publish();

    expect(result.outcome).toBe("published");
  });

  it("doesn't double the slash when WEB_APP_URL has a trailing one", async () => {
    fetchMock.mockResolvedValue(okResponse());

    await makeService({ ...CONFIGURED, WEB_APP_URL: "https://kudos-cards.co.uk/" }).publish();

    expect(callUrl(0)).toBe("https://kudos-cards.co.uk/api/revalidate-catalog");
    expect(callUrl(1)).toBe("https://kudos-cards.co.uk/cards");
  });

  it("reports not-configured, and calls nothing, without the secret", async () => {
    const result = await makeService({ WEB_APP_URL: "https://kudos-cards.co.uk" }).publish();

    expect(result.outcome).toBe("not-configured");
    expect(result.reason).toContain("CATALOG_REVALIDATE_SECRET");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the web app's own explanation when it refuses", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: () =>
        Promise.resolve('{"reason":"CATALOG_REVALIDATE_SECRET is not set on the web app"}'),
    });

    const result = await makeService(CONFIGURED).publish();

    expect(result.outcome).toBe("failed");
    expect(result.reason).toContain("503");
    // The body matters: "503" alone sends an operator hunting in the wrong app.
    expect(result.reason).toContain("not set on the web app");
  });

  it("survives the web app being unreachable rather than failing the sync", async () => {
    fetchMock.mockRejectedValue(new Error("fetch failed"));

    const result = await makeService(CONFIGURED).publish();

    expect(result.outcome).toBe("failed");
    expect(result.reason).toContain("fetch failed");
  });
});
