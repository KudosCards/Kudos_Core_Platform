import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import {
  accountSchema,
  supportTicketDetailSchema,
  supportTicketOpsDetailSchema,
  type SupportTicketDetail,
} from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

describe("Support ticketing (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function opsToken(): Promise<{ token: string; userId: string }> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId, email: `ops-${userId}@kudoscards.co.uk` } });
    return { token: await mintToken(userId), userId };
  }

  async function signUp(): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID());
    const res = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Support Test ${randomUUID()}` })
      .expect(201);
    return { token, accountId: accountSchema.parse(res.body).id };
  }

  async function raiseTicket(
    token: string,
    body: Partial<{ subject: string; category: string; message: string }> = {},
  ): Promise<SupportTicketDetail> {
    const res = await request(app.getHttpServer())
      .post("/support")
      .set("Authorization", `Bearer ${token}`)
      .send({
        subject: body.subject ?? "I need help with billing",
        category: body.category ?? "billing",
        message: body.message ?? "My invoice looks wrong this month.",
      })
      .expect(201);
    return supportTicketDetailSchema.parse(res.body);
  }

  it("raises a ticket: opens it, records the first message, defaults whose-turn to support", async () => {
    const { token } = await signUp();
    const ticket = await raiseTicket(token);

    expect(ticket).toMatchObject({
      subject: "I need help with billing",
      category: "billing",
      status: "open",
      priority: "normal",
      lastMessageFrom: "customer",
    });
    expect(ticket.ticketNumber).toBeGreaterThanOrEqual(1000);
    expect(ticket.messages).toHaveLength(1);
    expect(ticket.messages[0]).toMatchObject({
      authorType: "customer",
      body: "My invoice looks wrong this month.",
      internalNote: false,
    });
  });

  it("lists the account's own tickets and scopes them to the account", async () => {
    const a = await signUp();
    const b = await signUp();
    const ticket = await raiseTicket(a.token);

    const mine = await request(app.getHttpServer())
      .get("/support")
      .set("Authorization", `Bearer ${a.token}`)
      .expect(200);
    expect((mine.body as unknown[]).some((t) => (t as { id: string }).id === ticket.id)).toBe(true);

    // Account B can neither see nor fetch account A's ticket.
    const others = await request(app.getHttpServer())
      .get("/support")
      .set("Authorization", `Bearer ${b.token}`)
      .expect(200);
    expect((others.body as unknown[]).some((t) => (t as { id: string }).id === ticket.id)).toBe(false);
    await request(app.getHttpServer())
      .get(`/support/${ticket.id}`)
      .set("Authorization", `Bearer ${b.token}`)
      .expect(404);
  });

  it("full two-way thread: ops reply hands back to the customer + notifies them; customer reply reopens", async () => {
    const { token, accountId } = await signUp();
    const ops = await opsToken();
    const ticket = await raiseTicket(token);

    // It shows in the ops queue with the account identity.
    const queue = await request(app.getHttpServer())
      .get("/admin/support?status=open")
      .set("Authorization", `Bearer ${ops.token}`)
      .expect(200);
    const queueBody = queue.body as { total: number; items: { id: string; businessName: string }[] };
    expect(queueBody.items.some((i) => i.id === ticket.id)).toBe(true);

    // Ops replies → awaiting_customer, whose-turn flips to support-sent.
    const opsReply = await request(app.getHttpServer())
      .post(`/admin/support/${ticket.id}/reply`)
      .set("Authorization", `Bearer ${ops.token}`)
      .send({ body: "Happy to help — can you confirm the invoice number?" })
      .expect(201);
    const opsDetail = supportTicketOpsDetailSchema.parse(opsReply.body);
    expect(opsDetail).toMatchObject({ status: "awaiting_customer", lastMessageFrom: "support" });
    expect(opsDetail.messages).toHaveLength(2);

    // The customer got an inbox notification for the reply.
    const notifs = await prisma.notification.findMany({
      where: { accountId, kind: "support_reply" },
    });
    expect(notifs.length).toBeGreaterThanOrEqual(1);
    expect(notifs[0]?.href).toBe(`/support/${ticket.id}`);

    // Customer replies → reopens to open, whose-turn back to customer.
    const custReply = await request(app.getHttpServer())
      .post(`/support/${ticket.id}/reply`)
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "It's INV-2026-07." })
      .expect(201);
    const custDetail = supportTicketDetailSchema.parse(custReply.body);
    expect(custDetail).toMatchObject({ status: "open", lastMessageFrom: "customer" });
    expect(custDetail.messages).toHaveLength(3);
  });

  it("hides internal notes from the customer and leaves whose-turn untouched", async () => {
    const { token } = await signUp();
    const ops = await opsToken();
    const ticket = await raiseTicket(token);

    const withNote = await request(app.getHttpServer())
      .post(`/admin/support/${ticket.id}/reply`)
      .set("Authorization", `Bearer ${ops.token}`)
      .send({ body: "Internal: check Stripe for a failed charge.", internalNote: true })
      .expect(201);
    const opsDetail = supportTicketOpsDetailSchema.parse(withNote.body);
    // Ops sees the note; the ticket is still open (an internal note isn't a reply).
    expect(opsDetail.status).toBe("open");
    expect(opsDetail.messages.some((m) => m.internalNote)).toBe(true);

    // The customer's detail view never includes the internal note.
    const custView = await request(app.getHttpServer())
      .get(`/support/${ticket.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const custDetail = supportTicketDetailSchema.parse(custView.body);
    expect(custDetail.messages).toHaveLength(1);
    expect(custDetail.messages.every((m) => !m.internalNote)).toBe(true);
  });

  it("ops can set priority and assign the ticket to themselves", async () => {
    const { token } = await signUp();
    const ops = await opsToken();
    const ticket = await raiseTicket(token);

    const updated = await request(app.getHttpServer())
      .patch(`/admin/support/${ticket.id}`)
      .set("Authorization", `Bearer ${ops.token}`)
      .send({ priority: "high", assign: "me" })
      .expect(200);
    const detail = supportTicketOpsDetailSchema.parse(updated.body);
    expect(detail.priority).toBe("high");
    expect(detail.assignee).toBe(`ops-${ops.userId}@kudoscards.co.uk`);

    // Unassign.
    const unassigned = await request(app.getHttpServer())
      .patch(`/admin/support/${ticket.id}`)
      .set("Authorization", `Bearer ${ops.token}`)
      .send({ assign: "none" })
      .expect(200);
    expect(supportTicketOpsDetailSchema.parse(unassigned.body).assignee).toBeNull();
  });

  it("resolve then customer reply reopens the ticket", async () => {
    const { token } = await signUp();
    const ops = await opsToken();
    const ticket = await raiseTicket(token);

    await request(app.getHttpServer())
      .patch(`/admin/support/${ticket.id}`)
      .set("Authorization", `Bearer ${ops.token}`)
      .send({ status: "resolved" })
      .expect(200);

    const reopened = await request(app.getHttpServer())
      .post(`/support/${ticket.id}/reply`)
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "Actually, one more thing..." })
      .expect(201);
    expect(supportTicketDetailSchema.parse(reopened.body).status).toBe("open");
  });

  it("customer can close a ticket, after which replies are refused on both sides", async () => {
    const { token } = await signUp();
    const ops = await opsToken();
    const ticket = await raiseTicket(token);

    const closed = await request(app.getHttpServer())
      .post(`/support/${ticket.id}/close`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    expect(supportTicketDetailSchema.parse(closed.body).status).toBe("closed");

    await request(app.getHttpServer())
      .post(`/support/${ticket.id}/reply`)
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "hello?" })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/admin/support/${ticket.id}/reply`)
      .set("Authorization", `Bearer ${ops.token}`)
      .send({ body: "hello?" })
      .expect(409);
  });

  it("rejects an unauthenticated ticket creation and validates input", async () => {
    const { token } = await signUp();
    await request(app.getHttpServer()).post("/support").send({ subject: "x", message: "y" }).expect(401);
    // Subject too short (min 3).
    await request(app.getHttpServer())
      .post("/support")
      .set("Authorization", `Bearer ${token}`)
      .send({ subject: "ab", message: "a real message" })
      .expect(400);
    // Empty message.
    await request(app.getHttpServer())
      .post("/support")
      .set("Authorization", `Bearer ${token}`)
      .send({ subject: "A valid subject", message: "" })
      .expect(400);
  });

  it("requires ops privileges for the admin queue", async () => {
    const { token } = await signUp();
    await request(app.getHttpServer())
      .get("/admin/support")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
  });
});
