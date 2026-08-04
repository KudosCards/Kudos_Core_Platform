import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { segmentsOverviewSchema, type SegmentSummary } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * Segments (smart lists): the overview resolves suggested presets + saved
 * segments live; occasion-mode presets ride the occasion engine, contact-mode
 * the recipients. See docs/adr/0105-segments-smart-lists.md.
 */
describe("Segments (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function signUp(): Promise<string> {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Seg Test ${randomUUID()}` })
      .expect(201);
    return token;
  }

  async function addRecipient(token: string, body: Record<string, unknown>): Promise<void> {
    await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Seg", lastName: randomUUID().slice(0, 8), ...body })
      .expect(201);
  }

  function preset(overview: { suggested: SegmentSummary[] }, key: string): SegmentSummary {
    const found = overview.suggested.find((s) => s.key === key);
    if (!found) throw new Error(`missing preset ${key}`);
    return found;
  }

  it("resolves suggested presets — birthdays this month, and missing-address", async () => {
    const token = await signUp();
    const thisMonth = new Date().getUTCMonth() + 1;
    // A mailable contact with a birthday this month → counts for the birthday preset.
    await addRecipient(token, {
      dateOfBirth: `2015-${String(thisMonth).padStart(2, "0")}-15`,
      addressLine1: "1 Test Street",
      addressCity: "London",
      addressPostcode: "SW1A 1AA",
    });
    // A contact with no address → counts for the missing-address preset only.
    await addRecipient(token, { dateOfBirth: null });

    const res = await request(app.getHttpServer())
      .get("/segments")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const overview = segmentsOverviewSchema.parse(res.body);

    expect(preset(overview, "birthdays-this-month").count).toBeGreaterThanOrEqual(1);
    expect(preset(overview, "missing-address").count).toBeGreaterThanOrEqual(1);
    // The birthday preset previews the person by name with an occasion detail.
    expect(preset(overview, "birthdays-this-month").sample[0]?.detail).toContain("Birthday");
    expect(overview.saved).toHaveLength(0);
  });

  it("saves a suggested preset as a reusable smart list, then removes it", async () => {
    const token = await signUp();
    const res = await request(app.getHttpServer())
      .get("/segments")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const source = preset(segmentsOverviewSchema.parse(res.body), "renewals-due");

    const created = await request(app.getHttpServer())
      .post("/segments")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "My renewals", definition: source.definition })
      .expect(201);
    const saved = created.body as SegmentSummary;
    const savedId = saved.id;
    if (!savedId) throw new Error("expected a saved segment id");
    expect(saved.suggested).toBe(false);

    // It now appears under saved.
    const after = segmentsOverviewSchema.parse(
      (
        await request(app.getHttpServer())
          .get("/segments")
          .set("Authorization", `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    expect(after.saved.map((s) => s.id)).toContain(savedId);

    await request(app.getHttpServer())
      .delete(`/segments/${savedId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);
    const rows = await prisma.segment.findMany({ where: { id: savedId } });
    expect(rows).toHaveLength(0);
  });

  it("rejects an invalid definition and a duplicate name", async () => {
    const token = await signUp();
    // Neither occasion nor contact filter → invalid.
    await request(app.getHttpServer())
      .post("/segments")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Empty", definition: {} })
      .expect(400);

    const definition = { contact: { hasMailableAddress: false } };
    await request(app.getHttpServer())
      .post("/segments")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Dupe", definition })
      .expect(201);
    await request(app.getHttpServer())
      .post("/segments")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Dupe", definition })
      .expect(400);
  });
});
