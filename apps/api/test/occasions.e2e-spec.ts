import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { z } from "zod";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

const occasionSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  recipientId: z.string().uuid().nullable(),
  type: z.string(),
  source: z.string(),
  status: z.string(),
  savedDesignId: z.string().uuid().nullable(),
});

const paginatedOccasionsSchema = z.object({
  items: z.array(occasionSchema),
  total: z.number(),
});

describe("Occasions (e2e)", () => {
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

  async function createRecipient(token: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: "Sam", lastName: "Recipient" })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  async function getFirstTemplateId(token: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .get("/card-designs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    return (response.body as { id: string }[])[0]!.id;
  }

  async function createSavedDesign(token: string): Promise<string> {
    const cardDesignId = await getFirstTemplateId(token);
    const response = await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({ cardDesignId, name: "Test design" })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  it("creates an org-wide occasion with no recipient", async () => {
    const { token } = await signUp();
    const response = await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "bespoke_campaign", occasionDate: "2026-09-01" })
      .expect(201);
    const created = occasionSchema.parse(response.body);

    expect(created.recipientId).toBeNull();
    expect(created.source).toBe("one_off_campaign");
    expect(created.status).toBe("pending_approval");
  });

  it("creates a recipient-linked occasion and rejects a recipient from another account", async () => {
    const { token } = await signUp();
    const recipientId = await createRecipient(token);

    await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "achievement", occasionDate: "2026-09-01", recipientId })
      .expect(201);

    const otherAccount = await signUp();
    await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${otherAccount.token}`)
      .send({ type: "achievement", occasionDate: "2026-09-01", recipientId })
      .expect(404);
  });

  it("lists occasions scoped to the account, filterable by status", async () => {
    const { token } = await signUp();
    await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "seasonal", occasionDate: "2026-12-01" })
      .expect(201);

    const listResponse = await request(app.getHttpServer())
      .get("/occasions?status=pending_approval")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const list = paginatedOccasionsSchema.parse(listResponse.body);
    expect(list.total).toBe(1);

    const emptyResponse = await request(app.getHttpServer())
      .get("/occasions?status=approved")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(paginatedOccasionsSchema.parse(emptyResponse.body).total).toBe(0);
  });

  it("filters occasions by type and date range (for the calendar)", async () => {
    const { token } = await signUp();
    // A May birthday and a December seasonal occasion.
    await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "birthday", occasionDate: "2026-05-14" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "seasonal", occasionDate: "2026-12-01" })
      .expect(201);

    // A May window returns only the birthday.
    const mayResponse = await request(app.getHttpServer())
      .get("/occasions?from=2026-05-01&to=2026-05-31")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const may = paginatedOccasionsSchema.parse(mayResponse.body);
    expect(may.total).toBe(1);
    expect(may.items[0]?.type).toBe("birthday");

    // A type filter returns only the seasonal occasion.
    const seasonalResponse = await request(app.getHttpServer())
      .get("/occasions?type=seasonal")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const seasonal = paginatedOccasionsSchema.parse(seasonalResponse.body);
    expect(seasonal.total).toBe(1);
    expect(seasonal.items[0]?.type).toBe("seasonal");
  });

  it("approves an occasion with a saved design, scoped to the account", async () => {
    const { token } = await signUp();
    const savedDesignId = await createSavedDesign(token);
    const createResponse = await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "leaver", occasionDate: "2026-09-01" })
      .expect(201);
    const created = occasionSchema.parse(createResponse.body);

    const approveResponse = await request(app.getHttpServer())
      .post(`/occasions/${created.id}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ savedDesignId })
      .expect(201);
    const approved = occasionSchema.parse(approveResponse.body);

    expect(approved.status).toBe("approved");
    expect(approved.savedDesignId).toBe(savedDesignId);
  });

  it("rejects approving with a saved design from another account", async () => {
    const { token } = await signUp();
    const createResponse = await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "leaver", occasionDate: "2026-09-01" })
      .expect(201);
    const created = occasionSchema.parse(createResponse.body);

    const otherAccount = await signUp();
    const otherSavedDesignId = await createSavedDesign(otherAccount.token);

    await request(app.getHttpServer())
      .post(`/occasions/${created.id}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ savedDesignId: otherSavedDesignId })
      .expect(404);
  });

  it("rejects approving an occasion that isn't pending approval", async () => {
    const { token } = await signUp();
    const savedDesignId = await createSavedDesign(token);
    const createResponse = await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "leaver", occasionDate: "2026-09-01" })
      .expect(201);
    const created = occasionSchema.parse(createResponse.body);

    await request(app.getHttpServer())
      .post(`/occasions/${created.id}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ savedDesignId })
      .expect(201);

    // Already approved — approving again must fail cleanly, not silently re-apply.
    await request(app.getHttpServer())
      .post(`/occasions/${created.id}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ savedDesignId })
      .expect(409);
  });

  it("skips an occasion", async () => {
    const { token } = await signUp();
    const createResponse = await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "staff_recognition", occasionDate: "2026-09-01" })
      .expect(201);
    const created = occasionSchema.parse(createResponse.body);

    const skipResponse = await request(app.getHttpServer())
      .post(`/occasions/${created.id}/skip`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    expect(occasionSchema.parse(skipResponse.body).status).toBe("skipped");

    await request(app.getHttpServer())
      .post(`/occasions/${created.id}/skip`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);
  });

  it("only one of two concurrent approve/skip calls on the same occasion succeeds", async () => {
    const { token } = await signUp();
    const savedDesignId = await createSavedDesign(token);
    const createResponse = await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "leaver", occasionDate: "2026-09-01" })
      .expect(201);
    const created = occasionSchema.parse(createResponse.body);

    const [approveResult, skipResult] = await Promise.all([
      request(app.getHttpServer())
        .post(`/occasions/${created.id}/approve`)
        .set("Authorization", `Bearer ${token}`)
        .send({ savedDesignId }),
      request(app.getHttpServer())
        .post(`/occasions/${created.id}/skip`)
        .set("Authorization", `Bearer ${token}`),
    ]);

    const statuses = [approveResult.status, skipResult.status].sort();
    expect(statuses).toEqual([201, 409]);

    const final = await prisma.occasion.findUniqueOrThrow({ where: { id: created.id } });
    expect(["approved", "skipped"]).toContain(final.status);
  });

  it("adds a hand-curated recipient event as a scheduled calendar entry with a title", async () => {
    const { token } = await signUp();
    const recipientId = await createRecipient(token);

    const response = await request(app.getHttpServer())
      .post("/occasions/events")
      .set("Authorization", `Bearer ${token}`)
      .send({ recipientId, type: "achievement", title: "Graduation", occasionDate: "2026-07-15" })
      .expect(201);
    const created = occasionSchema.parse(response.body);

    expect(created.status).toBe("scheduled");
    expect(created.source).toBe("one_off_campaign");
    expect((response.body as { title: string }).title).toBe("Graduation");

    // Filterable by recipient for the recipient detail page.
    const byRecipient = await request(app.getHttpServer())
      .get(`/occasions?recipientId=${recipientId}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const list = paginatedOccasionsSchema.parse(byRecipient.body);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]?.id).toBe(created.id);
  });

  it("rejects an event for a recipient that doesn't belong to the account", async () => {
    const accountA = await signUp();
    const accountB = await signUp();
    const recipientId = await createRecipient(accountA.token);

    await request(app.getHttpServer())
      .post("/occasions/events")
      .set("Authorization", `Bearer ${accountB.token}`)
      .send({ recipientId, type: "achievement", occasionDate: "2026-07-15" })
      .expect(404);
  });

  it("promotes a scheduled event into the approvals queue via prepare", async () => {
    const { token } = await signUp();
    const recipientId = await createRecipient(token);
    const created = occasionSchema.parse(
      (
        await request(app.getHttpServer())
          .post("/occasions/events")
          .set("Authorization", `Bearer ${token}`)
          .send({ recipientId, type: "leaver", occasionDate: "2026-07-20" })
          .expect(201)
      ).body,
    );

    const prepared = occasionSchema.parse(
      (
        await request(app.getHttpServer())
          .post(`/occasions/${created.id}/prepare`)
          .set("Authorization", `Bearer ${token}`)
          .expect(201)
      ).body,
    );
    expect(prepared.status).toBe("pending_approval");

    // It now shows in the approvals queue and can't be prepared again.
    await request(app.getHttpServer())
      .post(`/occasions/${created.id}/prepare`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);
  });

  it("deletes a scheduled event but refuses to delete one already in the pipeline", async () => {
    const { token } = await signUp();
    const recipientId = await createRecipient(token);
    const created = occasionSchema.parse(
      (
        await request(app.getHttpServer())
          .post("/occasions/events")
          .set("Authorization", `Bearer ${token}`)
          .send({ recipientId, type: "seasonal", occasionDate: "2026-08-05" })
          .expect(201)
      ).body,
    );

    // Promote it, then deletion must be refused (409) — it's part of a workflow now.
    await request(app.getHttpServer())
      .post(`/occasions/${created.id}/prepare`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/occasions/${created.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);

    // A fresh scheduled event deletes cleanly.
    const fresh = occasionSchema.parse(
      (
        await request(app.getHttpServer())
          .post("/occasions/events")
          .set("Authorization", `Bearer ${token}`)
          .send({ recipientId, type: "seasonal", occasionDate: "2026-09-05" })
          .expect(201)
      ).body,
    );
    await request(app.getHttpServer())
      .delete(`/occasions/${fresh.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);
    expect(await prisma.occasion.findUnique({ where: { id: fresh.id } })).toBeNull();
  });
});
