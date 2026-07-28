import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

describe("Pricing (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns the account's per-card pricing + postage + VAT rate", async () => {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Test Centre ${randomUUID()}` })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get("/pricing")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    const body = response.body as {
      cardPriceMinor: number;
      cardDiscountPercent: number;
      fullCardPriceMinor: number;
      postageMinor: { first_class: number; second_class: number };
      vatRatePercent: number;
    };
    // A fresh account is on the free plan (no discount) at the full £2.50 price.
    expect(body.fullCardPriceMinor).toBe(250);
    expect(body.cardPriceMinor).toBe(250);
    expect(body.cardDiscountPercent).toBe(0);
    expect(body.postageMinor).toEqual({ first_class: 180, second_class: 91 });
    expect(body.vatRatePercent).toBe(20);
  });

  it("requires authentication", async () => {
    await request(app.getHttpServer()).get("/pricing").expect(401);
  });
});
