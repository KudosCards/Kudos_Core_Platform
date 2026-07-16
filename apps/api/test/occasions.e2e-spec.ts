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
});
