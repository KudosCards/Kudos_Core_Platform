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

  it("hard-deletes an unreferenced design", async () => {
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
      .send({ cardDesignId: template?.id, name: "Disposable" })
      .expect(201);
    const created = savedDesignSchema.parse(createResponse.body);

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/saved-designs/${created.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(deleteResponse.body).toEqual({ archived: false });

    await request(app.getHttpServer())
      .get(`/saved-designs/${created.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
  });

  it("archives (not 409s) a design referenced by an approved occasion, and hides it", async () => {
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

    // Attach the design to an occasion directly via Prisma (approve endpoint is
    // covered in occasions.e2e-spec.ts) so the FK-restrict path is exercised.
    const createResponse = await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({ cardDesignId: template?.id, name: "Attached to an occasion" })
      .expect(201);
    const created = savedDesignSchema.parse(createResponse.body);

    await prisma.occasion.create({
      data: {
        accountId,
        type: "bespoke_campaign",
        source: "one_off_campaign",
        occasionDate: new Date(),
        status: "approved",
        savedDesignId: created.id,
      },
    });

    // Delete now archives (kept for the occasion's history) rather than 409ing.
    const deleteResponse = await request(app.getHttpServer())
      .delete(`/saved-designs/${created.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(deleteResponse.body).toEqual({ archived: true });

    // The row still exists (history intact) but is out of the library and API.
    expect(await prisma.savedDesign.findUnique({ where: { id: created.id } })).not.toBeNull();
    await request(app.getHttpServer())
      .get(`/saved-designs/${created.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
    const listResponse = await request(app.getHttpServer())
      .get("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const designs = z.array(savedDesignSchema).parse(listResponse.body);
    expect(designs.some((d) => d.id === created.id)).toBe(false);
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

  /**
   * The reserved-footer guardrail (ADR 0171).
   *
   * The strip along the bottom of the back is physically pre-printed with the
   * Kudos logo and the QR a recipient scans to reach their message. Anything a
   * customer places there is clipped at print, silently. Rather than warn about
   * that and then let it through — which is how a 76-card order went out with a
   * partner advert grid running into the strip — a design that does it can no
   * longer be *stored*. That closes every downstream route at once, including
   * unattended auto-send and returns reprints, which create orders straight
   * through Prisma and never reach BatchOrdersService.
   */
  describe("reserved footer", () => {
    /** y=520 sits inside the reserved strip on A6 (it starts at y=505.5). */
    const backWith = (elements: unknown[], background?: unknown) => ({
      version: 1,
      pages: [
        artworkDocument.pages[0],
        { name: "inside-left", elements: [] },
        { name: "inside-right", elements: [] },
        { name: "back", ...(background ? { background } : {}), elements },
      ],
    });

    const advert = (y: number) => ({
      kind: "image",
      id: randomUUID(),
      assetUrl: "https://cdn.example.com/partner-advert.png",
      x: 0,
      y,
      width: 450,
      height: 60,
      rotation: 0,
    });

    it("refuses to store a design with an element in the reserved strip", async () => {
      const { token, accountId } = await signUp();
      await prisma.account.update({ where: { id: accountId }, data: { planId: "pro" } });
      const response = await request(app.getHttpServer())
        .post("/saved-designs")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Partner adverts", document: backWith([advert(520)]) })
        .expect(400);
      expect((response.body as { message: string }).message).toContain("30mm");
      expect((response.body as { message: string }).message).toContain("QR code");
    });

    it("stores the same design once the element moves above the line", async () => {
      const { token, accountId } = await signUp();
      await prisma.account.update({ where: { id: accountId }, data: { planId: "pro" } });
      await request(app.getHttpServer())
        .post("/saved-designs")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Partner adverts", document: backWith([advert(400)]) })
        .expect(201);
    });

    it("allows a background that runs into the strip", async () => {
      // A background always covers it and simply ends at the line — the designed
      // behaviour, not a fault. Refusing it would refuse nearly every back.
      const { token, accountId } = await signUp();
      await prisma.account.update({ where: { id: accountId }, data: { planId: "pro" } });
      await request(app.getHttpServer())
        .post("/saved-designs")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Full bleed back",
          document: backWith([], { type: "color", color: "#123456" }),
        })
        .expect(201);
    });

    it("refuses to update a good design into a bad one", async () => {
      const { token, accountId } = await signUp();
      await prisma.account.update({ where: { id: accountId }, data: { planId: "pro" } });
      const created = await request(app.getHttpServer())
        .post("/saved-designs")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Fine for now", document: backWith([advert(400)]) })
        .expect(201);
      const id = (created.body as { id: string }).id;

      await request(app.getHttpServer())
        .patch(`/saved-designs/${id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ document: backWith([advert(520)]) })
        .expect(400);

      // And the stored design is untouched — a refused save must not half-apply.
      const stored = await prisma.savedDesign.findUniqueOrThrow({ where: { id } });
      const back = (stored.document as { pages: { name: string; elements: { y: number }[] }[] })
        .pages.find((page) => page.name === "back");
      expect(back?.elements[0]?.y).toBe(400);
    });
  });

});
