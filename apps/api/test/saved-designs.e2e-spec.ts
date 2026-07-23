import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { z } from "zod";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

const cardDesignSchema = z.object({
  id: z.string().uuid(),
  category: z.string(),
  name: z.string(),
});

const savedDesignSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  cardDesignId: z.string().uuid().nullable(),
  name: z.string(),
  document: z.object({ version: z.literal(1), pages: z.array(z.unknown()) }),
});

/** A minimal valid custom-artwork document: one full-bleed image on the front. */
const artworkDocument = {
  version: 1,
  pages: [
    {
      name: "front",
      elements: [
        {
          kind: "image",
          id: randomUUID(),
          assetUrl: "https://cdn.example.com/artwork.png",
          x: 0,
          y: 0,
          width: 450,
          height: 600,
          rotation: 0,
        },
      ],
    },
    { name: "inside-left", elements: [] },
    { name: "inside-right", elements: [] },
    { name: "back", elements: [] },
  ],
};

describe("Saved designs (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function signUp(): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID());
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Test Centre ${randomUUID()}` })
      .expect(201);
    return { token, accountId: accountSchema.parse(response.body).id };
  }

  it("lists the seeded card design templates", async () => {
    const { token } = await signUp();
    const response = await request(app.getHttpServer())
      .get("/card-designs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const templates = z.array(cardDesignSchema).parse(response.body);
    expect(templates.length).toBeGreaterThanOrEqual(3);
    expect(templates.some((t) => t.category === "birthday")).toBe(true);
  });

  it("creates a saved design from a template, unedited", async () => {
    const { token } = await signUp();
    const [template] = z
      .array(cardDesignSchema)
      .parse(
        (
          await request(app.getHttpServer())
            .get("/card-designs")
            .set("Authorization", `Bearer ${token}`)
            .expect(200)
        ).body,
      );

    const createResponse = await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({ cardDesignId: template?.id, name: "My birthday card" })
      .expect(201);
    const created = savedDesignSchema.parse(createResponse.body);

    expect(created.name).toBe("My birthday card");
    expect(created.cardDesignId).toBe(template?.id);
  });

  it("rejects a malformed design document", async () => {
    const { token } = await signUp();
    const [template] = z
      .array(cardDesignSchema)
      .parse(
        (
          await request(app.getHttpServer())
            .get("/card-designs")
            .set("Authorization", `Bearer ${token}`)
            .expect(200)
        ).body,
      );

    await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        cardDesignId: template?.id,
        name: "Broken",
        document: { version: 1, pages: [{ name: "not-a-real-page", elements: [] }] },
      })
      .expect(400);
  });

  it("updates a saved design's name and document, scoped to the account", async () => {
    const accountA = await signUp();
    const accountB = await signUp();
    const [template] = z
      .array(cardDesignSchema)
      .parse(
        (
          await request(app.getHttpServer())
            .get("/card-designs")
            .set("Authorization", `Bearer ${accountA.token}`)
            .expect(200)
        ).body,
      );

    const createResponse = await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${accountA.token}`)
      .send({ cardDesignId: template?.id, name: "Original name" })
      .expect(201);
    const created = savedDesignSchema.parse(createResponse.body);

    // Another account can't see or modify it.
    await request(app.getHttpServer())
      .get(`/saved-designs/${created.id}`)
      .set("Authorization", `Bearer ${accountB.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/saved-designs/${created.id}`)
      .set("Authorization", `Bearer ${accountB.token}`)
      .send({ name: "Hijacked" })
      .expect(404);

    const updateResponse = await request(app.getHttpServer())
      .patch(`/saved-designs/${created.id}`)
      .set("Authorization", `Bearer ${accountA.token}`)
      .send({ name: "Renamed" })
      .expect(200);
    expect(savedDesignSchema.parse(updateResponse.body).name).toBe("Renamed");
  });

  it("deletes a saved design, but not one referenced by an approved occasion", async () => {
    const { token, accountId } = await signUp();
    const [template] = z
      .array(cardDesignSchema)
      .parse(
        (
          await request(app.getHttpServer())
            .get("/card-designs")
            .set("Authorization", `Bearer ${token}`)
            .expect(200)
        ).body,
      );

    const createResponse = await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({ cardDesignId: template?.id, name: "Disposable" })
      .expect(201);
    const created = savedDesignSchema.parse(createResponse.body);

    await request(app.getHttpServer())
      .delete(`/saved-designs/${created.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/saved-designs/${created.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(404);

    // Re-create and attach it to an occasion directly via Prisma (approve
    // endpoint is covered in occasions.e2e-spec.ts) to verify the FK-restrict
    // -> clean 409 mapping.
    const recreateResponse = await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({ cardDesignId: template?.id, name: "Attached to an occasion" })
      .expect(201);
    const recreated = savedDesignSchema.parse(recreateResponse.body);

    await prisma.occasion.create({
      data: {
        accountId,
        type: "bespoke_campaign",
        source: "one_off_campaign",
        occasionDate: new Date(),
        status: "approved",
        savedDesignId: recreated.id,
      },
    });

    await request(app.getHttpServer())
      .delete(`/saved-designs/${recreated.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);
  });

  it("rejects custom artwork (no template) on the free plan", async () => {
    const { token } = await signUp();
    // New accounts default to the free plan, which lacks customArtworkEnabled.
    await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "My own artwork", document: artworkDocument })
      .expect(403);
  });

  it("rejects a custom design with no template and no document", async () => {
    const { token, accountId } = await signUp();
    // Upgrade so we get past the entitlement gate and hit the document check.
    await prisma.account.update({ where: { id: accountId }, data: { planId: "pro" } });
    await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "No document" })
      .expect(400);
  });

  it("creates a custom design from uploaded artwork on a plan that allows it", async () => {
    const { token, accountId } = await signUp();
    await prisma.account.update({ where: { id: accountId }, data: { planId: "pro" } });

    const createResponse = await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "My own artwork", document: artworkDocument })
      .expect(201);
    const created = savedDesignSchema.parse(createResponse.body);

    expect(created.name).toBe("My own artwork");
    expect(created.cardDesignId).toBeNull();

    // It shows up in the account's saved designs like any other.
    const listResponse = await request(app.getHttpServer())
      .get("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const designs = z.array(savedDesignSchema).parse(listResponse.body);
    expect(designs.some((d) => d.id === created.id && d.cardDesignId === null)).toBe(true);
  });
});
