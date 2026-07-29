import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { designAssetSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { z } from "zod";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

describe("Design assets (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function signUp(): Promise<string> {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Test Centre ${randomUUID()}` })
      .expect(201);
    return token;
  }

  it("requires auth", async () => {
    await request(app.getHttpServer()).get("/design-assets").expect(401);
  });

  it("records an uploaded asset, lists it, and removes it", async () => {
    const token = await signUp();

    const created = await request(app.getHttpServer())
      .post("/design-assets")
      .set("Authorization", `Bearer ${token}`)
      .send({
        url: "https://storage.example.com/design-assets/logo.png",
        fileName: "logo.png",
        width: 800,
        height: 400,
      })
      .expect(201);
    const asset = designAssetSchema.parse(created.body);
    expect(asset).toMatchObject({ fileName: "logo.png", width: 800, height: 400 });

    const listed = await request(app.getHttpServer())
      .get("/design-assets")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const assets = z.array(designAssetSchema).parse(listed.body);
    expect(assets.map((a) => a.id)).toContain(asset.id);

    await request(app.getHttpServer())
      .delete(`/design-assets/${asset.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    const after = await request(app.getHttpServer())
      .get("/design-assets")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(z.array(designAssetSchema).parse(after.body)).toHaveLength(0);
  });

  it("records optional dimensions as null when omitted", async () => {
    const token = await signUp();
    const created = await request(app.getHttpServer())
      .post("/design-assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ url: "https://storage.example.com/design-assets/plain.jpg", fileName: "plain.jpg" })
      .expect(201);
    const asset = designAssetSchema.parse(created.body);
    expect(asset.width).toBeNull();
    expect(asset.height).toBeNull();
  });

  it("rejects a non-URL url", async () => {
    const token = await signUp();
    await request(app.getHttpServer())
      .post("/design-assets")
      .set("Authorization", `Bearer ${token}`)
      .send({ url: "not-a-url", fileName: "x.png" })
      .expect(400);
  });

  it("scopes assets to the account — one account cannot see or delete another's", async () => {
    const tokenA = await signUp();
    const tokenB = await signUp();

    const created = await request(app.getHttpServer())
      .post("/design-assets")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({ url: "https://storage.example.com/design-assets/a.png", fileName: "a.png" })
      .expect(201);
    const assetId = (created.body as { id: string }).id;

    // B doesn't see A's asset...
    const listB = await request(app.getHttpServer())
      .get("/design-assets")
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(200);
    expect(z.array(designAssetSchema).parse(listB.body)).toHaveLength(0);

    // ...and can't delete it (404, not a silent success).
    await request(app.getHttpServer())
      .delete(`/design-assets/${assetId}`)
      .set("Authorization", `Bearer ${tokenB}`)
      .expect(404);

    // A still has it.
    const listA = await request(app.getHttpServer())
      .get("/design-assets")
      .set("Authorization", `Bearer ${tokenA}`)
      .expect(200);
    expect(z.array(designAssetSchema).parse(listA.body).map((a) => a.id)).toContain(assetId);
  });
});
