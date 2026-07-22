import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { createTestApp } from "./util/create-test-app";

describe("HealthController (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health is a dependency-free liveness check (no DB ping)", async () => {
    const response = await request(app.getHttpServer()).get("/health").expect(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("GET /health/ready reports the database as up", async () => {
    const response = await request(app.getHttpServer()).get("/health/ready").expect(200);
    expect(response.body).toMatchObject({
      status: "ok",
      info: { database: { status: "up" } },
    });
  });
});
