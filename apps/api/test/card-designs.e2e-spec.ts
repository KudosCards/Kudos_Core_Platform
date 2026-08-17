import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { z } from "zod";
import { createTestApp } from "./util/create-test-app";

/**
 * The card catalog is the public marketing library — an unauthenticated visitor
 * browses it before signing up ("pick a card → personalise → sign up"). These
 * tests pin that it's reachable with NO Authorization header, unlike every other
 * resource route (which the global JWT guard 401s).
 */
const cardDesignSchema = z.object({
  id: z.string().uuid(),
  category: z.string(),
  name: z.string(),
  slug: z.string(),
  thumbnailUrl: z.string(),
  isActive: z.boolean(),
});

describe("Card designs — public catalog (e2e)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("lists the catalog without authentication", async () => {
    const response = await request(app.getHttpServer()).get("/card-designs").expect(200);
    const designs = z.array(cardDesignSchema).parse(response.body);
    expect(designs.length).toBeGreaterThan(0);
    // Only active templates are exposed publicly.
    expect(designs.every((d) => d.isActive)).toBe(true);
  });

  it("returns a single catalog design without authentication", async () => {
    const list = await request(app.getHttpServer()).get("/card-designs").expect(200);
    const first = z.array(cardDesignSchema).parse(list.body)[0]!;

    const response = await request(app.getHttpServer())
      .get(`/card-designs/${first.id}`)
      .expect(200);
    expect(cardDesignSchema.parse(response.body).id).toBe(first.id);
  });

  /**
   * The catalog moved to /cards/<category>/<slug> (ADR 0163). The web app now
   * resolves designs by slug, while the UUID form has to keep working: it's in
   * Google's index, in saved links, and printed as a QR code on cards already in
   * the post.
   */
  it("resolves the same design by slug as by id", async () => {
    const list = await request(app.getHttpServer()).get("/card-designs").expect(200);
    const first = z.array(cardDesignSchema).parse(list.body)[0]!;
    expect(first.slug).not.toBe("");

    const bySlug = await request(app.getHttpServer())
      .get(`/card-designs/${first.slug}`)
      .expect(200);
    expect(cardDesignSchema.parse(bySlug.body).id).toBe(first.id);
  });

  it("404s an unknown slug rather than leaking a different design", async () => {
    await request(app.getHttpServer()).get("/card-designs/no-such-card-slug").expect(404);
  });

  it("400s a malformed identifier instead of querying with it", async () => {
    // Unauthenticated endpoint: an unbounded path segment shouldn't reach the DB.
    await request(app.getHttpServer()).get("/card-designs/not_a_valid_slug!").expect(400);
    await request(app.getHttpServer())
      .get(`/card-designs/${"a".repeat(150)}`)
      .expect(400);
  });

  it("still 401s a protected resource route with no token (guard is on by default)", async () => {
    // Contrast: the catalog is a deliberate @Public() exception, not a hole in
    // the global guard.
    await request(app.getHttpServer()).get("/recipients").expect(401);
  });
});
