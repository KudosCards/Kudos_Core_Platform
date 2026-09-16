import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { enterpriseEnquiryAckSchema, enterpriseEnquirySchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { EMAIL_CLIENT } from "../src/email/email.client";
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
  const sendTransactional = jest.fn().mockResolvedValue(undefined);
  const originalInbox = process.env.SUPPORT_INBOX_EMAIL;

  beforeAll(async () => {
    // Without an ops inbox configured, notifyOps returns before it sends and
    // every "did ops get emailed?" assertion below would pass vacuously.
    process.env.SUPPORT_INBOX_EMAIL = "ops-e2e@kudoscards.co.uk";
    app = await createTestApp([{ provide: EMAIL_CLIENT, useValue: { sendTransactional } }]);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
    process.env.SUPPORT_INBOX_EMAIL = originalInbox;
  });

  beforeEach(() => {
    sendTransactional.mockClear();
  });

  async function opsToken(): Promise<string> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({
      data: { userId, email: `ops-${userId}@kudoscards.co.uk` },
    });
    return mintToken(userId);
  }

  /**
   * A distinct client IP per submission. The public endpoint is throttled at
   * 5/min per IP, and this file posts well past that — which is also exactly how
   * the real thing arrives, since bot form-fillers come from scattered
   * addresses and that is precisely why the throttle never stopped them.
   * Routed through X-Forwarded-For, which the app resolves via TRUST_PROXY_HOPS
   * (ADR 0133), the same as in production.
   */
  let nextClient = 0;
  function submitAs() {
    nextClient += 1;
    return request(app.getHttpServer())
      .post("/enterprise-enquiries")
      .set("X-Forwarded-For", `203.0.113.${nextClient % 254}`);
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
    const res = await submitAs().send(validBody).expect(201);

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
    // And ops were nudged — the control for every "no email" assertion below.
    expect(sendTransactional).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid submission (bad email)", async () => {
    await submitAs()
      .send({ ...validBody, email: "not-an-email" })
      .expect(400);
  });

  it("lets ops list and triage a lead; blocks non-admins", async () => {
    const created = await submitAs()
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

  /**
   * The spam gate. Nothing is ever rejected — ADR 0101's promise is that a sales
   * lead is never lost — so a caught submission is stored with the rule that
   * caught it, kept out of the open queue, and not emailed to ops. See ADR 0244.
   */
  describe("the spam gate", () => {
    async function submit(body: Record<string, unknown>): Promise<string> {
      const res = await submitAs().send(body).expect(201);
      return enterpriseEnquiryAckSchema.parse(res.body).id;
    }

    it("catches a filled honeypot, stores it, and leaves ops alone", async () => {
      const id = await submit({ ...validBody, contactReference: "wpZXqYlycGeEyTXT" });

      const stored = await prisma.enterpriseEnquiry.findUnique({ where: { id } });
      expect(stored).toMatchObject({ status: "spam", spamReason: "honeypot" });
      // The lead is not lost — everything the bot typed is still here.
      expect(stored?.organisation).toBe(validBody.organisation);
      expect(sendTransactional).not.toHaveBeenCalled();
    });

    it("catches a form submitted faster than a person could fill it", async () => {
      const id = await submit({ ...validBody, formOpenedAt: new Date().toISOString() });

      const stored = await prisma.enterpriseEnquiry.findUnique({ where: { id } });
      expect(stored).toMatchObject({ status: "spam", spamReason: "submitted-too-fast" });
      expect(sendTransactional).not.toHaveBeenCalled();
    });

    it("catches a message with no words in it", async () => {
      // The real submission that prompted this: the message was `8838149310`.
      const id = await submit({ ...validBody, message: "8838149310" });

      const stored = await prisma.enterpriseEnquiry.findUnique({ where: { id } });
      expect(stored).toMatchObject({ status: "spam", spamReason: "message-has-no-words" });
      expect(sendTransactional).not.toHaveBeenCalled();
    });

    it("lets a real enquiry through even with the honeypot present but blank", async () => {
      // What a genuine browser submits: the hidden field, empty.
      const id = await submit({
        ...validBody,
        contactReference: "",
        formOpenedAt: new Date(Date.now() - 90_000).toISOString(),
      });

      const stored = await prisma.enterpriseEnquiry.findUnique({ where: { id } });
      expect(stored).toMatchObject({ status: "new", spamReason: null });
      expect(sendTransactional).toHaveBeenCalledTimes(1);
    });

    it("gives a bot an ack it cannot tell from a real one", async () => {
      const clean = await submitAs().send(validBody).expect(201);
      const caught = await submitAs()
        .send({ ...validBody, contactReference: "x" })
        .expect(201);

      // Same status code, same keys, same reported status. Nothing to tune against.
      expect(Object.keys(caught.body as object).sort()).toEqual(
        Object.keys(clean.body as object).sort(),
      );
      const parsed = enterpriseEnquiryAckSchema.parse(caught.body);
      expect(parsed.status).toBe("new");
      expect(caught.body).not.toHaveProperty("spamReason");
    });

    it("keeps caught leads out of the queue ops actually look at", async () => {
      const id = await submit({ ...validBody, organisation: "Spamco", contactReference: "x" });
      const token = await opsToken();

      const open = await request(app.getHttpServer())
        .get("/admin/enterprise-enquiries?status=open&perPage=100")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      const openIds = (open.body as { items: { id: string }[] }).items.map((row) => row.id);
      expect(openIds).not.toContain(id);

      // But reviewable on its own tab, with the reason shown.
      const spam = await request(app.getHttpServer())
        .get("/admin/enterprise-enquiries?status=spam&perPage=100")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      const rows = (spam.body as { items: unknown[] }).items.map((row) =>
        enterpriseEnquirySchema.parse(row),
      );
      expect(rows.find((row) => row.id === id)?.spamReason).toBe("honeypot");
    });

    it("lets ops restore a lead the gate shouldn't have caught", async () => {
      const id = await submit({ ...validBody, message: "0800 123 456" });
      const token = await opsToken();

      const restored = await request(app.getHttpServer())
        .patch(`/admin/enterprise-enquiries/${id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ status: "new" })
        .expect(200);
      expect(enterpriseEnquirySchema.parse(restored.body).status).toBe("new");

      const open = await request(app.getHttpServer())
        .get("/admin/enterprise-enquiries?status=open&perPage=100")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      const openIds = (open.body as { items: { id: string }[] }).items.map((row) => row.id);
      expect(openIds).toContain(id);
    });

    it("lets ops bin a lead the gate missed", async () => {
      const id = await submit(validBody);
      const token = await opsToken();

      await request(app.getHttpServer())
        .patch(`/admin/enterprise-enquiries/${id}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ status: "spam" })
        .expect(200);

      const open = await request(app.getHttpServer())
        .get("/admin/enterprise-enquiries?status=open&perPage=100")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      const openIds = (open.body as { items: { id: string }[] }).items.map((row) => row.id);
      expect(openIds).not.toContain(id);
    });

    it("still rejects a payload with a field we don't know about", async () => {
      // forbidNonWhitelisted is what makes the honeypot safe to declare: an
      // undeclared field 400s, which would tell a bot exactly what tripped it.
      await submitAs()
        .send({ ...validBody, someOtherField: "x" })
        .expect(400);
    });
  });

  it("blocks the ops queue for a normal (non-admin) user", async () => {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .get("/admin/enterprise-enquiries")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });
});
