import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import {
  segmentMembersSchema,
  segmentPreviewSchema,
  segmentSummarySchema,
  segmentsOverviewSchema,
  type SegmentSummary,
} from "@kudos/shared-types";
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

  async function addRecipient(
    token: string,
    body: Record<string, unknown>,
  ): Promise<{ id: string; accountId: string }> {
    const res = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Seg", lastName: randomUUID().slice(0, 8), ...body })
      .expect(201);
    return res.body as { id: string; accountId: string };
  }

  /**
   * Seed a contact with no postal address — the manual-add DTO requires one
   * (docs/adr/0067), so unmailable contacts only ever arrive via CSV/CRM import.
   * Tests reproduce that by inserting directly, the way ingest does.
   */
  async function addUnmailable(accountId: string): Promise<void> {
    await prisma.recipient.create({
      data: {
        accountId,
        firstName: "No",
        lastName: `Address ${randomUUID().slice(0, 8)}`,
        source: "csv",
      },
    });
  }

  /** A mailable contact (the manual-add DTO requires a full UK address). */
  function addMailable(
    token: string,
    body: Record<string, unknown> = {},
  ): Promise<{ id: string; accountId: string }> {
    return addRecipient(token, {
      addressLine1: "1 Test Street",
      addressCity: "London",
      addressPostcode: "SW1A 1AA",
      ...body,
    });
  }

  /** A DOB (yyyy-mm-dd) whose birthday lands today — always inside the current
   * month's window, so "birthdays this month" matches it deterministically. */
  function birthdayTodayDob(): string {
    const now = new Date();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    return `2015-${mm}-${dd}`;
  }

  function preset(overview: { suggested: SegmentSummary[] }, key: string): SegmentSummary {
    const found = overview.suggested.find((s) => s.key === key);
    if (!found) throw new Error(`missing preset ${key}`);
    return found;
  }

  it("resolves suggested presets — birthdays this month, and missing-address", async () => {
    const token = await signUp();
    // A mailable contact with a birthday this month → counts for the birthday preset.
    const { accountId } = await addMailable(token, { dateOfBirth: birthdayTodayDob() });
    // A contact with no address → counts for the missing-address preset only.
    await addUnmailable(accountId);

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

  it("resolves a preset's members (distinct recipients) for the composer", async () => {
    const token = await signUp();
    // Two contacts with a birthday this month → members; one with no birthday is not.
    await addMailable(token, { dateOfBirth: birthdayTodayDob() });
    await addMailable(token, { dateOfBirth: birthdayTodayDob() });
    await addMailable(token, { dateOfBirth: null });

    const res = await request(app.getHttpServer())
      .get("/segments/members?segment=birthdays-this-month")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const result = segmentMembersSchema.parse(res.body);

    expect(result.name).toBe("Birthdays this month");
    expect(result.total).toBe(2);
    expect(result.members).toHaveLength(2);
    expect(result.capped).toBe(false);
    // Occasion-mode: each member carries their matched birthday for reconciliation.
    expect(result.reconciliations).toHaveLength(2);
    const memberIds = new Set(result.members.map((m) => m.id));
    for (const r of result.reconciliations) {
      expect(memberIds.has(r.recipientId)).toBe(true);
      expect(r.occasionType).toBe("birthday");
    }
  });

  it("returns no reconciliations for a contact-mode segment", async () => {
    const token = await signUp();
    await addMailable(token, { dateOfBirth: birthdayTodayDob() });

    const created = (
      await request(app.getHttpServer())
        .post("/segments")
        .set("Authorization", `Bearer ${token}`)
        .send({ name: "Everyone", definition: { contact: { status: "active" } } })
        .expect(201)
    ).body as SegmentSummary;

    const members = segmentMembersSchema.parse(
      (
        await request(app.getHttpServer())
          .get(`/segments/members?segment=${created.id}`)
          .set("Authorization", `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    expect(members.members.length).toBeGreaterThanOrEqual(1);
    expect(members.reconciliations).toHaveLength(0);
  });

  it("resolves a saved segment's members by id", async () => {
    const token = await signUp();
    await addMailable(token, { dateOfBirth: birthdayTodayDob() });

    const overview = segmentsOverviewSchema.parse(
      (
        await request(app.getHttpServer())
          .get("/segments")
          .set("Authorization", `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    const created = (
      await request(app.getHttpServer())
        .post("/segments")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "My birthdays",
          definition: preset(overview, "birthdays-this-month").definition,
        })
        .expect(201)
    ).body as SegmentSummary;

    const res = await request(app.getHttpServer())
      .get(`/segments/members?segment=${created.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const result = segmentMembersSchema.parse(res.body);
    expect(result.name).toBe("My birthdays");
    expect(result.total).toBe(1);
    expect(result.members).toHaveLength(1);
  });

  it("caps members at the plan's per-order limit and flags it", async () => {
    const token = await signUp();
    // The free plan's batchOrderMaxSize is 10 (seed.ts). 11 contacts with a
    // birthday this month all match → the set is capped at 10 and flagged.
    for (let i = 0; i < 11; i++) {
      await addMailable(token, { dateOfBirth: birthdayTodayDob() });
    }

    const res = await request(app.getHttpServer())
      .get("/segments/members?segment=birthdays-this-month")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const result = segmentMembersSchema.parse(res.body);

    expect(result.total).toBe(11);
    expect(result.members).toHaveLength(10);
    expect(result.capped).toBe(true);
  });

  it("404s for an unknown segment", async () => {
    const token = await signUp();
    await request(app.getHttpServer())
      .get("/segments/members?segment=not-a-real-segment")
      .set("Authorization", `Bearer ${token}`)
      .expect(404);
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

  it("previews a rule that has not been saved", async () => {
    const token = await signUp();
    const { accountId } = await addMailable(token);
    await addUnmailable(accountId);
    await addUnmailable(accountId);

    const res = await request(app.getHttpServer())
      .post("/segments/preview")
      .set("Authorization", `Bearer ${token}`)
      .send({ definition: { contact: { hasMailableAddress: false } } })
      .expect(200);
    expect(segmentPreviewSchema.parse(res.body).count).toBe(2);

    // Previewing must not save: the account still has no smart lists.
    const overview = await request(app.getHttpServer())
      .get("/segments")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(segmentsOverviewSchema.parse(overview.body).saved).toHaveLength(0);
  });

  it("rejects a preview of an empty rule", async () => {
    const token = await signUp();
    await request(app.getHttpServer())
      .post("/segments/preview")
      .set("Authorization", `Bearer ${token}`)
      .send({ definition: {} })
      .expect(400);
  });

  it("renames a saved smart list without restating its rule", async () => {
    const token = await signUp();
    const { accountId } = await addMailable(token);
    await addUnmailable(accountId);

    const definition = { contact: { hasMailableAddress: false } };
    const created = await request(app.getHttpServer())
      .post("/segments")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Needs an address", definition })
      .expect(201);
    const id = segmentSummarySchema.parse(created.body).id!;

    const renamed = await request(app.getHttpServer())
      .patch(`/segments/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Chase for addresses" })
      .expect(200);
    const after = segmentSummarySchema.parse(renamed.body);
    expect(after.name).toBe("Chase for addresses");
    // The rule is untouched by a name-only edit, and still resolves.
    expect(after.definition).toEqual(definition);
    expect(after.count).toBe(1);
  });

  it("changes a saved smart list's rule, and the count follows", async () => {
    const token = await signUp();
    const { accountId } = await addMailable(token);
    await addUnmailable(accountId);

    const created = await request(app.getHttpServer())
      .post("/segments")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Rule swap", definition: { contact: { hasMailableAddress: false } } })
      .expect(201);
    const id = segmentSummarySchema.parse(created.body).id!;
    expect(segmentSummarySchema.parse(created.body).count).toBe(1);

    const updated = await request(app.getHttpServer())
      .patch(`/segments/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ definition: { contact: { status: "active" } } })
      .expect(200);
    const after = segmentSummarySchema.parse(updated.body);
    expect(after.name).toBe("Rule swap");
    expect(after.count).toBe(2);
  });

  it("rejects an empty update, an invalid rule, and a name already in use", async () => {
    const token = await signUp();
    const definition = { contact: { hasMailableAddress: false } };
    const created = await request(app.getHttpServer())
      .post("/segments")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "First", definition })
      .expect(201);
    const id = segmentSummarySchema.parse(created.body).id!;
    await request(app.getHttpServer())
      .post("/segments")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Second", definition })
      .expect(201);

    // Nothing to change is a mistake, not a no-op worth accepting.
    await request(app.getHttpServer())
      .patch(`/segments/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({})
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/segments/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ definition: {} })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/segments/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Second" })
      .expect(400);
  });

  it("scopes editing to the account — one account cannot rename another's smart list", async () => {
    const accountA = await signUp();
    const accountB = await signUp();
    const created = await request(app.getHttpServer())
      .post("/segments")
      .set("Authorization", `Bearer ${accountA}`)
      .send({ name: "A's list", definition: { contact: { hasMailableAddress: false } } })
      .expect(201);
    const id = segmentSummarySchema.parse(created.body).id!;

    await request(app.getHttpServer())
      .patch(`/segments/${id}`)
      .set("Authorization", `Bearer ${accountB}`)
      .send({ name: "Stolen" })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/segments/${id}`)
      .set("Authorization", `Bearer ${accountB}`)
      .expect(404);
  });
});
