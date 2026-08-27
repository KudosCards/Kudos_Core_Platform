import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { enterpriseEnquiryAckSchema, enterpriseEnquirySchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * Enterprise "Contact us" leads: a public (unauthenticated) submit that persists
 * the lead, and the ops (PlatformAdmin) queue that lists and triages them.
 * See docs/adr/0101-enterprise-plan-enquiries.md.
 */
describe("Enterprise enquiries (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function opsToken(): Promise<string> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({
      data: { userId, email: `ops-${userId}@kudoscards.co.uk` },
    });
    return mintToken(userId);
  }

  const validBody = {
    name: "Dana Ops",
    email: "dana@bigtutoring.example",
    organisation: "Big Tutoring Group",
    phone: "020 7946 0000",
    teamSize: "800 students across 3 sites",
    message: "We run three centres and want cards handled centrally.",
  };

  it("captures a public enquiry (no auth) and stores it as 'new'", async () => {
    const res = await request(app.getHttpServer())
      .post("/enterprise-enquiries")
      .send(validBody)
      .expect(201);

    const ack = enterpriseEnquiryAckSchema.parse(res.body);
    expect(ack.status).toBe("new");

    const stored = await prisma.enterpriseEnquiry.findUnique({ where: { id: ack.id } });
    expect(stored).toMatchObject({
      organisation: "Big Tutoring Group",
      email: "dana@bigtutoring.example",
      status: "new",
    });
    // The ack never leaks the whole row.
    expect(res.body).not.toHaveProperty("message");
  });

  it("rejects an invalid submission (bad email)", async () => {
    await request(app.getHttpServer())
      .post("/enterprise-enquiries")
      .send({ ...validBody, email: "not-an-email" })
      .expect(400);
  });

  it("lets ops list and triage a lead; blocks non-admins", async () => {
    const created = await request(app.getHttpServer())
      .post("/enterprise-enquiries")
      .send({ ...validBody, organisation: "Triage Academy" })
      .expect(201);
    const { id } = enterpriseEnquiryAckSchema.parse(created.body);

    const token = await opsToken();

    // Appears in the ops queue.
    const list = await request(app.getHttpServer())
      .get("/admin/enterprise-enquiries?status=open")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const listBody = list.body as { items: unknown[] };
    const found = listBody.items.map((row) => enterpriseEnquirySchema.parse(row));
    expect(found.some((row) => row.id === id)).toBe(true);

    // Move it to in_progress.
    const updated = await request(app.getHttpServer())
      .patch(`/admin/enterprise-enquiries/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "in_progress" })
      .expect(200);
    expect(enterpriseEnquirySchema.parse(updated.body).status).toBe("in_progress");

    // A closed lead drops out of the default "open" view.
    await request(app.getHttpServer())
      .patch(`/admin/enterprise-enquiries/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "closed" })
      .expect(200);
    const openAfter = await request(app.getHttpServer())
      .get("/admin/enterprise-enquiries?status=open")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const openBody = openAfter.body as { items: { id: string }[] };
    const openIds = openBody.items.map((row) => row.id);
    expect(openIds).not.toContain(id);
  });

  it("blocks the ops queue for a normal (non-admin) user", async () => {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .get("/admin/enterprise-enquiries")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });
});
