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
import { DESIGN_ASSET_STORAGE_CLIENT } from "../src/storage/design-asset-storage.provider";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * Stands in for Supabase Storage. Support attachments live in a private bucket
 * now, so reads mint a signed URL — without this the e2e would depend on a live
 * project and the network. The URL shape is what the assertions key off: it has
 * to be visibly a *signed* URL, not the public one that used to be stored.
 */
const storageStub = {
  storage: {
    from: () => ({
      createSignedUrls: (paths: string[], expiresIn: number) =>
        Promise.resolve({
          data: paths.map((path) => ({
            path,
            signedUrl: `https://proj.supabase.co/storage/v1/object/sign/support-attachments/${path}?token=stub&exp=${expiresIn}`,
            error: null,
          })),
          error: null,
        }),
      createSignedUploadUrl: (path: string) =>
        Promise.resolve({ data: { path, token: "stub-token" }, error: null }),
      getPublicUrl: (path: string) => ({
        data: {
          publicUrl: `https://proj.supabase.co/storage/v1/object/public/support-attachments/${path}`,
        },
      }),
    }),
  },
};

describe("Support ticketing (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp([{ provide: DESIGN_ASSET_STORAGE_CLIENT, useValue: storageStub }]);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function opsToken(): Promise<{ token: string; userId: string }> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({
      data: { userId, email: `ops-${userId}@kudoscards.co.uk` },
    });
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

  describe("attachment ownership", () => {
    /** A file reference as the browser submits it, for `accountId`. */
    function attachmentFor(accountId: string) {
      return {
        path: `${accountId}/1-shot.png`,
        fileName: "shot.png",
        contentType: "image/png",
        sizeBytes: 512,
        kind: "image" as const,
      };
    }

    /** Not async: returns supertest's chainable so callers can `.expect(...)`. */
    function attach(token: string, attachment: unknown) {
      return request(app.getHttpServer())
        .post("/support")
        .set("Authorization", `Bearer ${token}`)
        .send({
          subject: "Attachment check",
          category: "other",
          message: "See attached.",
          attachments: [attachment],
        });
    }

    it("refuses a path belonging to another account", async () => {
      const victim = await signUp();
      const attacker = await signUp();

      // The client uploads directly to storage and then tells us what it
      // uploaded, so this claim is the only thing standing between one customer
      // and another's screenshots.
      await attach(attacker.token, attachmentFor(victim.accountId)).expect(403);
    });

    it("refuses an account id that merely starts with the caller's", async () => {
      const { token, accountId } = await signUp();

      // A startsWith() check would let this through: same prefix, different
      // account. Ownership is the whole leading path segment.
      await attach(token, {
        ...attachmentFor(accountId),
        path: `${accountId}extra/1-shot.png`,
      }).expect(403);
    });

    it("refuses a URL pointing somewhere that isn't our bucket", async () => {
      const { token } = await signUp();

      // Left unchecked this is stored verbatim and later opened by support from
      // the ops portal — an attacker-chosen URL loaded by an operator.
      await attach(token, {
        url: "https://evil.test/tracker.png",
        fileName: "shot.png",
        contentType: "image/png",
        sizeBytes: 512,
        kind: "image",
      }).expect(400);
    });

    it("refuses a malformed URL without falling over", async () => {
      const { token } = await signUp();

      // decodeURIComponent throws URIError on a broken escape, and this string
      // comes straight off the wire. Unhandled it is a 500; the caller should
      // get a 400 for sending nonsense.
      await attach(token, {
        url: "https://proj.supabase.co/storage/v1/object/public/support-attachments/acct/%ZZ.png",
        fileName: "shot.png",
        contentType: "image/png",
        sizeBytes: 512,
        kind: "image",
      }).expect(400);
    });

    it("refuses a traversal attempt in the path", async () => {
      const { token, accountId } = await signUp();

      await attach(token, {
        ...attachmentFor(accountId),
        path: `${accountId}/../other/1-shot.png`,
      }).expect(400);
    });

    it("still accepts the legacy public-URL form for the caller's own account", async () => {
      const { token, accountId } = await signUp();

      // A browser running the previous build mid-deploy sends `url`, not
      // `path`. The path is derived from it and checked the same way, so
      // attaching keeps working rather than 400ing for a few minutes.
      const response = await attach(token, {
        url: `https://proj.supabase.co/storage/v1/object/public/support-attachments/${accountId}/1-shot.png`,
        fileName: "shot.png",
        contentType: "image/png",
        sizeBytes: 512,
        kind: "image",
      }).expect(201);

      const detail = supportTicketDetailSchema.parse(response.body);
      expect(detail.messages[0]?.attachments[0]?.url).toContain("/object/sign/");
    });
  });

  it("attaches screenshots to messages and captures diagnostics for ops", async () => {
    const { token, accountId } = await signUp();
    const ops = await opsToken();
    // Uploads land at `{accountId}/{uuid}-{file}`, and the API checks that
    // leading segment against the caller before storing anything.
    const attachment = {
      path: `${accountId}/1-error.png`,
      fileName: "error.png",
      contentType: "image/png",
      sizeBytes: 2048,
      kind: "image",
    };

    const created = supportTicketDetailSchema.parse(
      (
        await request(app.getHttpServer())
          .post("/support")
          .set("Authorization", `Bearer ${token}`)
          .send({
            subject: "The editor won't save",
            category: "design",
            message: "What happened:\nSaving spins forever.",
            attachments: [attachment],
            diagnostics: {
              pageUrl: "https://app.kudoscards.co.uk/designs/x/edit",
              userAgent: "Mozilla/5.0 Test",
              viewport: "1280x800",
              appVersion: "1.2.3",
            },
          })
          .expect(201)
      ).body,
    );
    expect(created.messages[0]?.attachments).toHaveLength(1);
    expect(created.messages[0]?.attachments[0]).toMatchObject({
      fileName: "error.png",
      kind: "image",
      sizeBytes: 2048,
    });
    // The whole point of the change: what comes back is a short-lived signed
    // URL, never the public one that anyone holding the link could read forever.
    const url = created.messages[0]?.attachments[0]?.url ?? "";
    expect(url).toContain("/object/sign/");
    expect(url).not.toContain("/object/public/");

    // Ops detail exposes both the attachment and the silently-captured diagnostics.
    const opsDetail = supportTicketOpsDetailSchema.parse(
      (
        await request(app.getHttpServer())
          .get(`/admin/support/${created.id}`)
          .set("Authorization", `Bearer ${ops.token}`)
          .expect(200)
      ).body,
    );
    expect(opsDetail.diagnostics).toMatchObject({ viewport: "1280x800", appVersion: "1.2.3" });
    expect(opsDetail.messages[0]?.attachments[0]?.fileName).toBe("error.png");

    // A customer reply carries its own attachment.
    const reply = supportTicketDetailSchema.parse(
      (
        await request(app.getHttpServer())
          .post(`/support/${created.id}/reply`)
          .set("Authorization", `Bearer ${token}`)
          .send({
            body: "Here's another screenshot.",
            attachments: [{ ...attachment, fileName: "second.png" }],
          })
          .expect(201)
      ).body,
    );
    const last = reply.messages[reply.messages.length - 1];
    expect(last?.attachments[0]?.fileName).toBe("second.png");
  });

  it("rejects an attachment with a non-URL location", async () => {
    const { token } = await signUp();
    await request(app.getHttpServer())
      .post("/support")
      .set("Authorization", `Bearer ${token}`)
      .send({
        subject: "Bad attachment",
        category: "other",
        message: "test",
        attachments: [
          {
            url: "not-a-url",
            fileName: "x.png",
            contentType: "image/png",
            sizeBytes: 1,
            kind: "image",
          },
        ],
      })
      .expect(400);
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
    expect((others.body as unknown[]).some((t) => (t as { id: string }).id === ticket.id)).toBe(
      false,
    );
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
    const queueBody = queue.body as {
      total: number;
      items: { id: string; businessName: string }[];
    };
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

  it("keeps resolvedAt when a resolved ticket is then closed", async () => {
    const { token } = await signUp();
    const ops = await opsToken();
    const ticket = await raiseTicket(token);
    const patch = (status: string) =>
      request(app.getHttpServer())
        .patch(`/admin/support/${ticket.id}`)
        .set("Authorization", `Bearer ${ops.token}`)
        .send({ status })
        .expect(200);

    // The documented happy path: open → resolved → closed. Nulling resolvedAt
    // on the way through `closed` loses time-to-resolution for every ticket
    // that ends the normal way — the only tickets whose resolution time is
    // worth measuring.
    await patch("resolved");
    const resolved = await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(resolved.resolvedAt).not.toBeNull();

    await patch("closed");
    const closed = await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(closed.closedAt).not.toBeNull();
    expect(closed.resolvedAt?.getTime()).toBe(resolved.resolvedAt?.getTime());
  });

  it("stamps on the move into a status, not on every write of it", async () => {
    const { token } = await signUp();
    const ops = await opsToken();
    const ticket = await raiseTicket(token);
    await request(app.getHttpServer())
      .patch(`/admin/support/${ticket.id}`)
      .set("Authorization", `Bearer ${ops.token}`)
      .send({ status: "resolved" })
      .expect(200);

    // Backdate it, then re-send the status it already has. An operator
    // re-saving a ticket must not silently reset when it was resolved.
    const resolvedAt = new Date(Date.now() - 3 * 86_400_000);
    await prisma.supportTicket.update({ where: { id: ticket.id }, data: { resolvedAt } });

    await request(app.getHttpServer())
      .patch(`/admin/support/${ticket.id}`)
      .set("Authorization", `Bearer ${ops.token}`)
      .send({ status: "resolved", priority: "high" })
      .expect(200);

    const after = await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after.resolvedAt?.getTime()).toBe(resolvedAt.getTime());
    expect(after.priority).toBe("high");
  });

  it("clears closedAt when a closed ticket is moved back to resolved", async () => {
    const { token } = await signUp();
    const ops = await opsToken();
    const ticket = await raiseTicket(token);
    const patch = (status: string) =>
      request(app.getHttpServer())
        .patch(`/admin/support/${ticket.id}`)
        .set("Authorization", `Bearer ${ops.token}`)
        .send({ status })
        .expect(200);

    await patch("resolved");
    await patch("closed");
    await patch("resolved");

    // Each stamp says the ticket reached that state and has not gone back
    // behind it. A ticket sitting at `resolved` is not closed, so a closure
    // time left over from a previous pass describes nothing.
    const after = await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after.closedAt).toBeNull();
    expect(after.resolvedAt).not.toBeNull();
  });

  it("clears both stamps when a closed ticket is reopened", async () => {
    const { token } = await signUp();
    const ops = await opsToken();
    const ticket = await raiseTicket(token);
    const patch = (status: string) =>
      request(app.getHttpServer())
        .patch(`/admin/support/${ticket.id}`)
        .set("Authorization", `Bearer ${ops.token}`)
        .send({ status })
        .expect(200);

    await patch("resolved");
    await patch("closed");
    await patch("open");

    // Reopening is the one move that clears them: the ticket is live again, so
    // a resolution or closure time would describe something that no longer
    // happened.
    const after = await prisma.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(after.resolvedAt).toBeNull();
    expect(after.closedAt).toBeNull();
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
    await request(app.getHttpServer())
      .post("/support")
      .send({ subject: "x", message: "y" })
      .expect(401);
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
