import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

describe("Accounts (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects requests with no bearer token", async () => {
    await request(app.getHttpServer()).get("/accounts/me").expect(401);
  });

  it("rejects /accounts/me before any account exists for the user", async () => {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .get("/accounts/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });

  it("signs up a new account and then fetches it via /accounts/me", async () => {
    const token = await mintToken(randomUUID());

    const signupResponse = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: "E2E Test Centre" })
      .expect(201);

    // Parsing through the shared contract schema both type-narrows the
    // response and verifies the API's real output matches what the
    // frontend is built against — not just this test's expectations.
    const signedUp = accountSchema.parse(signupResponse.body);
    expect(signedUp).toMatchObject({
      type: "organisation",
      name: "E2E Test Centre",
      planId: "free",
    });

    const meResponse = await request(app.getHttpServer())
      .get("/accounts/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const me = accountSchema.parse(meResponse.body);
    expect(me.id).toBe(signedUp.id);
  });

  it("rejects a second signup for the same user", async () => {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: "First" })
      .expect(201);

    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: "Second" })
      .expect(409);
  });

  it("rejects an invalid account type", async () => {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "not-a-real-type", name: "Bad Type" })
      .expect(400);
  });
});
