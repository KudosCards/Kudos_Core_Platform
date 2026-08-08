import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PasswordResetService } from "../src/auth/password-reset.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * Rate-limit coverage for public endpoints that were previously un-throttled
 * (audit follow-up to ADR 0133 — see ADR 0134): the anonymous password-reset
 * request, and the API-key-authenticated inbound integrations endpoint.
 */
describe("Public rate-limit coverage (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    // Stub the password-reset service so exhausting its limit doesn't attempt
    // real Supabase/email calls — we're exercising the throttler, not the send.
    app = await createTestApp([
      { provide: PasswordResetService, useValue: { requestReset: async (): Promise<void> => {} } },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST /auth/request-password-reset", () => {
    // Matches @Throttle on the controller. Keyed per IP (anonymous endpoint).
    const LIMIT = 5;

    function hit(ip: string): request.Test {
      return request(app.getHttpServer())
        .post("/auth/request-password-reset")
        .set("X-Forwarded-For", ip)
        .send({ email: `${randomUUID()}@example.com` });
    }

    it("throttles per client IP (email-bomb protection)", async () => {
      const attacker = "198.51.100.10";
      for (let i = 0; i < LIMIT; i++) {
        const res = await hit(attacker);
        expect(res.status).not.toBe(429);
      }
      // One over the limit for that IP.
      expect((await hit(attacker)).status).toBe(429);
      // A different IP has its own bucket.
      expect((await hit("198.51.100.20")).status).not.toBe(429);
    });
  });

  describe("GET /integrations/me", () => {
    // Matches @Throttle on the controller. Keyed per API key, not IP.
    const LIMIT = 60;

    async function createAccountWithApiKey(): Promise<string> {
      const token = await mintToken(randomUUID());
      await request(app.getHttpServer())
        .post("/accounts")
        .set("Authorization", `Bearer ${token}`)
        .send({ type: "organisation", name: `RL Test ${randomUUID()}` })
        .expect(201);
      const res = await request(app.getHttpServer())
        .post("/integrations/api-keys")
        .set("Authorization", `Bearer ${token}`)
        .send({ label: "rate-limit-test" })
        .expect(201);
      return (res.body as { key: string }).key;
    }

    function hit(apiKey: string): request.Test {
      return request(app.getHttpServer()).get("/integrations/me").set("x-api-key", apiKey);
    }

    it("gives each API key its own bucket, independent of source IP", async () => {
      const keyA = await createAccountWithApiKey();
      const keyB = await createAccountWithApiKey();

      // Exhaust key A's allowance (all from the same connection/IP).
      for (let i = 0; i < LIMIT; i++) {
        const res = await hit(keyA);
        expect(res.status).not.toBe(429);
      }
      expect((await hit(keyA)).status).toBe(429);

      // Key B — same source IP, different key — is unaffected, proving the
      // limit is keyed on the API key rather than the (shared) IP.
      expect((await hit(keyB)).status).not.toBe(429);
    });
  });
});
