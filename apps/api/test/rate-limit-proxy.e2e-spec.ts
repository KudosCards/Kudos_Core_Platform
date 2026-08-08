import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { createTestApp } from "./util/create-test-app";

/**
 * The public message-page read is throttled at 30 requests/minute PER IP. The
 * throttler keys on the request IP, which is only the real client once Express
 * is told to trust the hosting proxy (TRUST_PROXY_HOPS, applied in
 * configureApp — the default of 1 is active here because the test app boots
 * through the exact same pipeline). Without that trust, every request behind a
 * reverse proxy carries the proxy's single socket IP, so all anonymous callers
 * share ONE bucket and the per-IP limit is really a global one.
 *
 * This spec drives distinct X-Forwarded-For client IPs through the real
 * pipeline and asserts each gets its own allowance: exhausting one client must
 * not spend another's. It is a regression guard — with trust-proxy disabled
 * both clients would collapse onto the socket IP and the second assertion would
 * fail.
 */
describe("Public rate limiting is per client IP (e2e)", () => {
  let app: INestApplication<App>;

  const LIMIT = 30; // must match the @Throttle on GET /messages/:slug
  const slug = "no-such-message-page"; // 404s after the throttler admits it — fine

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  function hit(ip: string): request.Test {
    return request(app.getHttpServer()).get(`/messages/${slug}`).set("X-Forwarded-For", ip);
  }

  it("blocks only the client that exhausted its allowance, not others", async () => {
    const clientA = "203.0.113.10";
    const clientB = "203.0.113.20";

    // Spend client A's whole allowance. Throttling runs before the handler, so
    // each admitted request is a normal (non-429) response even though the slug
    // does not exist.
    for (let i = 0; i < LIMIT; i++) {
      const res = await hit(clientA);
      expect(res.status).not.toBe(429);
    }

    // One more from A is over the limit.
    const overLimit = await hit(clientA);
    expect(overLimit.status).toBe(429);

    // A different client IP has its own untouched bucket — proving the limiter
    // keys on the forwarded client IP, not one shared proxy address.
    const otherClient = await hit(clientB);
    expect(otherClient.status).not.toBe(429);
  });
});
