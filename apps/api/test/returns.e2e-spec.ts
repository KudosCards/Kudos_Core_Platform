import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema, type ReturnCase } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

const DAY = 24 * 60 * 60 * 1000;

describe("Returns / RTS (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let savedDesignId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function opsToken(): Promise<string> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId } });
    return mintToken(userId);
  }

  async function signUp(): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID());
    const res = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `RTS Test ${randomUUID()}` })
      .expect(201);
    return { token, accountId: accountSchema.parse(res.body).id };
  }

  /** A posted card for an account, ready to be marked returned. */
  async function postedCard(
    accountId: string,
    opts: { occasionDate?: Date; withAddress?: boolean } = {},
  ): Promise<{ jobId: string; recipientId: string }> {
    if (!savedDesignId) {
      const design = await prisma.savedDesign.create({
        data: { accountId, name: "RTS design", document: {} },
      });
      savedDesignId = design.id;
    }
    const recipient = await prisma.recipient.create({
      data: {
        accountId,
        firstName: "Sam",
        lastName: "Jones",
        ...(opts.withAddress && {
          addressLine1: "1 Old Road",
          addressCity: "Leeds",
          addressPostcode: "LS1 1AA",
        }),
      },
    });
    const occasion = opts.occasionDate
      ? await prisma.occasion.create({
          data: {
            accountId,
            recipientId: recipient.id,
            type: "birthday",
            source: "recurring_per_recipient",
            occasionDate: opts.occasionDate,
            dispatchDate: opts.occasionDate,
            postageClass: "second_class",
            status: "posted",
          },
        })
      : null;
    const order = await prisma.batchOrder.create({
      data: { accountId, status: "fulfilling", subtotalMinor: 150, postageMinor: 91, totalMinor: 241 },
    });
    const orderRecipient = await prisma.orderRecipient.create({
      data: {
        batchOrderId: order.id,
        recipientId: recipient.id,
        occasionId: occasion?.id,
        savedDesignId,
        shippingAddressLine1: "1 Old Road",
        shippingAddressCity: "Leeds",
        shippingAddressPostcode: "LS1 1AA",
        dispatchOption: "asap",
        postageClass: "second_class",
        priceMinor: 150,
        postageMinor: 91,
        status: "posted",
      },
    });
    const job = await prisma.fulfillmentJob.create({
      data: { orderRecipientId: orderRecipient.id, status: "posted" },
    });
    return { jobId: job.id, recipientId: recipient.id };
  }

  it("marks a posted card returned: opens a case, flags the contact, sets statuses", async () => {
    const ops = await opsToken();
    const { accountId } = await signUp();
    const { jobId, recipientId } = await postedCard(accountId);

    const res = await request(app.getHttpServer())
      .post("/admin/returns")
      .set("Authorization", `Bearer ${ops}`)
      .send({ fulfillmentJobId: jobId, reason: "moved" })
      .expect(201);
    expect(res.body).toMatchObject({ status: "awaiting_address", reason: "moved", freeRecoveryUsed: false });

    const recipient = await prisma.recipient.findUniqueOrThrow({ where: { id: recipientId } });
    expect(recipient.addressVerificationRequired).toBe(true);
    const job = await prisma.fulfillmentJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe("returned_to_sender");
  });

  it("rejects marking a card that hasn't been posted", async () => {
    const ops = await opsToken();
    const { accountId } = await signUp();
    const { jobId } = await postedCard(accountId);
    await prisma.fulfillmentJob.update({ where: { id: jobId }, data: { status: "pending" } });

    await request(app.getHttpServer())
      .post("/admin/returns")
      .set("Authorization", `Bearer ${ops}`)
      .send({ fulfillmentJobId: jobId, reason: "moved" })
      .expect(409);
  });

  it("is idempotent per card — a second mark is a conflict", async () => {
    const ops = await opsToken();
    const { accountId } = await signUp();
    const { jobId } = await postedCard(accountId);
    await request(app.getHttpServer())
      .post("/admin/returns")
      .set("Authorization", `Bearer ${ops}`)
      .send({ fulfillmentJobId: jobId, reason: "undeliverable" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/admin/returns")
      .set("Authorization", `Bearer ${ops}`)
      .send({ fulfillmentJobId: jobId, reason: "undeliverable" })
      .expect(409);
  });

  it("update address → free resend: creates a £0 recovery order, resolves, clears the flag", async () => {
    const ops = await opsToken();
    const { token, accountId } = await signUp();
    // Occasion today, so the birthday hasn't passed.
    const { jobId, recipientId } = await postedCard(accountId, { occasionDate: new Date() });
    const marked = await request(app.getHttpServer())
      .post("/admin/returns")
      .set("Authorization", `Bearer ${ops}`)
      .send({ fulfillmentJobId: jobId, reason: "incorrect_address" })
      .expect(201);
    const caseId = (marked.body as ReturnCase).id;

    // Customer updates the address → awaiting_resend.
    const updated = await request(app.getHttpServer())
      .post(`/returns/${caseId}/address`)
      .set("Authorization", `Bearer ${token}`)
      .send({ addressLine1: "9 New Street", addressCity: "York", addressPostcode: "YO1 9AA" })
      .expect(201);
    expect((updated.body as ReturnCase).status).toBe("awaiting_resend");

    // Free resend.
    const recovered = await request(app.getHttpServer())
      .post(`/returns/${caseId}/resend`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    expect(recovered.body).toMatchObject({
      status: "resolved",
      resolution: "resend_recipient",
      freeRecoveryUsed: true,
    });

    // A £0 recovery order with a fresh pending fulfillment job exists.
    const recase = await prisma.returnCase.findUniqueOrThrow({ where: { id: caseId } });
    const recoveryOrder = await prisma.batchOrder.findUniqueOrThrow({
      where: { id: recase.recoveryOrderId! },
    });
    expect(recoveryOrder.totalMinor).toBe(0);
    const recoveryLines = await prisma.orderRecipient.findMany({
      where: { batchOrderId: recoveryOrder.id },
    });
    expect(recoveryLines).toHaveLength(1);
    expect(recoveryLines[0]?.shippingAddressPostcode).toBe("YO1 9AA");
    const recoveryJob = await prisma.fulfillmentJob.findFirst({
      where: { orderRecipientId: recoveryLines[0]?.id },
    });
    expect(recoveryJob?.status).toBe("pending");

    // The contact's flag is cleared, and a second resend is refused.
    const recipient = await prisma.recipient.findUniqueOrThrow({ where: { id: recipientId } });
    expect(recipient.addressVerificationRequired).toBe(false);
    await request(app.getHttpServer())
      .post(`/returns/${caseId}/resend`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);
  });

  it("blocks resend when the birthday has passed, but allows send-to-business", async () => {
    const ops = await opsToken();
    const { token, accountId } = await signUp();
    // Occasion 30 days ago → beyond the 7-day window.
    const { jobId } = await postedCard(accountId, { occasionDate: new Date(Date.now() - 30 * DAY) });
    const marked = await request(app.getHttpServer())
      .post("/admin/returns")
      .set("Authorization", `Bearer ${ops}`)
      .send({ fulfillmentJobId: jobId, reason: "moved" })
      .expect(201);
    const markedBody = marked.body as ReturnCase;
    const caseId = markedBody.id;
    expect(markedBody.resend.birthdayPassed).toBe(true);

    await request(app.getHttpServer())
      .post(`/returns/${caseId}/address`)
      .set("Authorization", `Bearer ${token}`)
      .send({ addressLine1: "9 New Street", addressCity: "York", addressPostcode: "YO1 9AA" })
      .expect(201);

    // Resend refused (birthday passed)...
    await request(app.getHttpServer())
      .post(`/returns/${caseId}/resend`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);

    // ...but hand-delivery to the business still works, free.
    const business = await request(app.getHttpServer())
      .post(`/returns/${caseId}/send-to-business`)
      .set("Authorization", `Bearer ${token}`)
      .send({ addressLine1: "Kudos Centre", addressCity: "York", addressPostcode: "YO1 2BB" })
      .expect(201);
    expect(business.body).toMatchObject({ status: "resolved", resolution: "send_business" });
  });

  it("scopes cases to the owning account", async () => {
    const ops = await opsToken();
    const a = await signUp();
    const b = await signUp();
    const { jobId } = await postedCard(a.accountId);
    const marked = await request(app.getHttpServer())
      .post("/admin/returns")
      .set("Authorization", `Bearer ${ops}`)
      .send({ fulfillmentJobId: jobId, reason: "moved" })
      .expect(201);
    // Account B can't see or act on account A's case.
    await request(app.getHttpServer())
      .get(`/returns/${(marked.body as ReturnCase).id}`)
      .set("Authorization", `Bearer ${b.token}`)
      .expect(404);
  });

  it("lists open cases in the ops queue", async () => {
    const ops = await opsToken();
    const { accountId } = await signUp();
    const { jobId } = await postedCard(accountId);
    await request(app.getHttpServer())
      .post("/admin/returns")
      .set("Authorization", `Bearer ${ops}`)
      .send({ fulfillmentJobId: jobId, reason: "moved" })
      .expect(201);

    const queue = await request(app.getHttpServer())
      .get("/admin/returns?status=open")
      .set("Authorization", `Bearer ${ops}`)
      .expect(200);
    const queueBody = queue.body as { total: number; items: unknown[] };
    expect(queueBody.total).toBeGreaterThanOrEqual(1);
    expect(queueBody.items[0]).toHaveProperty("daysSinceReturn");
  });

  describe("public self-serve email link (no login)", () => {
    it("recovers a card from the email token — view, update address, free resend", async () => {
      const ops = await opsToken();
      const { accountId } = await signUp();
      const { jobId } = await postedCard(accountId, { occasionDate: new Date() });
      const marked = await request(app.getHttpServer())
        .post("/admin/returns")
        .set("Authorization", `Bearer ${ops}`)
        .send({ fulfillmentJobId: jobId, reason: "moved" })
        .expect(201);
      const { publicToken } = await prisma.returnCase.findUniqueOrThrow({
        where: { id: (marked.body as ReturnCase).id },
        select: { publicToken: true },
      });
      expect(publicToken).toBeTruthy();

      // Every call below carries NO Authorization header — the token is the
      // only credential.
      const view = await request(app.getHttpServer()).get(`/rts/${publicToken}`).expect(200);
      expect((view.body as ReturnCase).recipientName).toBeTruthy();

      await request(app.getHttpServer())
        .post(`/rts/${publicToken}/address`)
        .send({ addressLine1: "9 New Street", addressCity: "York", addressPostcode: "YO1 9AA" })
        .expect(201);

      const recovered = await request(app.getHttpServer())
        .post(`/rts/${publicToken}/resend`)
        .expect(201);
      expect(recovered.body).toMatchObject({
        status: "resolved",
        resolution: "resend_recipient",
        freeRecoveryUsed: true,
      });
    });

    it("rejects an unknown token with 404", async () => {
      await request(app.getHttpServer()).get("/rts/not-a-real-token").expect(404);
    });
  });
});
