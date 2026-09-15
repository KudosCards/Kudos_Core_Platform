import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * A card must not be printed or posted to an address Royal Mail already sent
 * back.
 *
 * A card returned in October flags the contact, which pauses their *automatic*
 * sends. The card already paid for, already queued and addressed to the same
 * place kept going: it printed in December and posted to the address that had
 * just failed. See docs/returned-address-hold-plan.md.
 */
describe("Returned-address hold (e2e)", () => {
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
    await prisma.platformAdmin.create({ data: { userId, role: "super_admin" } });
    return mintToken(userId);
  }

  async function account(): Promise<string> {
    const token = await mintToken(randomUUID());
    const res = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Kip ${randomUUID().slice(0, 6)}` })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  /** One card for one contact at one address, at whatever status the test needs. */
  async function card(
    accountId: string,
    opts: {
      recipientId?: string;
      line1?: string;
      postcode?: string;
      status?: "pending" | "printed" | "posted";
    } = {},
  ): Promise<{ jobId: string; recipientId: string }> {
    const design = await prisma.savedDesign.create({
      data: { accountId, name: "Hold design", document: {} },
    });
    const recipientId =
      opts.recipientId ??
      (
        await prisma.recipient.create({
          data: { accountId, firstName: "Freddie", lastName: "Farrow" },
        })
      ).id;
    const order = await prisma.batchOrder.create({
      data: {
        accountId,
        status: "fulfilling",
        subtotalMinor: 250,
        postageMinor: 91,
        totalMinor: 341,
      },
    });
    const orderRecipient = await prisma.orderRecipient.create({
      data: {
        batchOrderId: order.id,
        recipientId,
        savedDesignId: design.id,
        documentSnapshot: { version: 1, pages: [{ name: "front", elements: [] }] },
        shippingAddressLine1: opts.line1 ?? "12 High Street",
        shippingAddressCity: "Kingston upon Hull",
        shippingAddressPostcode: opts.postcode ?? "HU8 9DJ",
        dispatchOption: "asap",
        postageClass: "second_class",
        priceMinor: 250,
        postageMinor: 91,
        status: opts.status === "posted" ? "posted" : "queued",
      },
    });
    const job = await prisma.fulfillmentJob.create({
      data: { orderRecipientId: orderRecipient.id, status: opts.status ?? "pending" },
    });
    return { jobId: job.id, recipientId };
  }

  /** Mark a posted card returned — the moment the address becomes known-bad. */
  async function markReturned(ops: string, jobId: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/admin/returns")
      .set("Authorization", `Bearer ${ops}`)
      .send({ fulfillmentJobId: jobId, reason: "moved" })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  it("refuses to print or post the next card to an address that came back", async () => {
    const ops = await opsToken();
    const accountId = await account();

    // October: a card comes back from 12 High Street.
    const sent = await card(accountId, { status: "posted" });
    await markReturned(ops, sent.jobId);

    // December: the card already paid for, same contact, same address.
    const queued = await card(accountId, {
      recipientId: sent.recipientId,
      status: "pending",
    });

    // Every way of producing or sending it is refused, by name.
    for (const path of ["/fulfillment/export", "/fulfillment/print-run"]) {
      const refused = await request(app.getHttpServer())
        .post(path)
        .set("Authorization", `Bearer ${ops}`)
        .send({ jobIds: [queued.jobId] })
        .expect(409);
      expect((refused.body as { message: string }).message).toContain("Freddie Farrow");
    }

    await request(app.getHttpServer())
      .post(`/fulfillment/jobs/${queued.jobId}/transition`)
      .set("Authorization", `Bearer ${ops}`)
      .send({ toStatus: "printed" })
      .expect(409);

    await request(app.getHttpServer())
      .post("/fulfillment/jobs/bulk-transition")
      .set("Authorization", `Bearer ${ops}`)
      .send({ jobIds: [queued.jobId], toStatus: "printed" })
      .expect(409);

    // And it never moved.
    const after = await prisma.fulfillmentJob.findUniqueOrThrow({ where: { id: queued.jobId } });
    expect(after.status).toBe("pending");
  });

  it("still lets an operator move a held card out of the way", async () => {
    // The hold blocks producing and posting, not the exits. A card nobody can
    // resolve is a card that sits in the queue forever.
    const ops = await opsToken();
    const accountId = await account();
    const sent = await card(accountId, { status: "posted" });
    await markReturned(ops, sent.jobId);
    const queued = await card(accountId, { recipientId: sent.recipientId, status: "pending" });

    await request(app.getHttpServer())
      .post(`/fulfillment/jobs/${queued.jobId}/transition`)
      .set("Authorization", `Bearer ${ops}`)
      .send({ toStatus: "failed", failureReason: "held, address unresolved" })
      .expect(201);
  });

  it("archiving the return does not release the card", async () => {
    // The check that decided the design. `archive()` can be called straight from
    // `awaiting_address`, before any correction, and it clears the contact's
    // addressVerificationRequired flag. A hold keyed on that flag would hand the
    // card straight back to the address that just failed.
    const ops = await opsToken();
    const accountId = await account();
    const sent = await card(accountId, { status: "posted" });
    const caseId = await markReturned(ops, sent.jobId);
    const queued = await card(accountId, { recipientId: sent.recipientId, status: "pending" });

    const owner = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(owner).toBeTruthy();
    await prisma.returnCase.update({
      where: { id: caseId },
      data: { status: "archived", resolvedAt: new Date(), resolution: "archived" },
    });
    await prisma.recipient.update({
      where: { id: sent.recipientId },
      data: { addressVerificationRequired: false },
    });

    const refused = await request(app.getHttpServer())
      .post("/fulfillment/print-run")
      .set("Authorization", `Bearer ${ops}`)
      .send({ jobIds: [queued.jobId] })
      .expect(409);
    expect((refused.body as { message: string }).message).toContain("Freddie Farrow");
  });

  it("leaves a card at a different address alone", async () => {
    // The falsifying case. A contact who has moved has cards at the *new*
    // address too, and holding those would stop the very thing that fixes it.
    const ops = await opsToken();
    const accountId = await account();
    const sent = await card(accountId, { status: "posted" });
    await markReturned(ops, sent.jobId);

    const moved = await card(accountId, {
      recipientId: sent.recipientId,
      line1: "4 Mill Lane",
      postcode: "HU5 2QR",
      status: "pending",
    });

    await request(app.getHttpServer())
      .post("/fulfillment/print-run")
      .set("Authorization", `Bearer ${ops}`)
      .send({ jobIds: [moved.jobId] })
      .expect(201);
  });

  it("leaves another contact at that address alone", async () => {
    // A pupil moving out of a household the family still lives in is the common
    // case. Holding a sibling's card would be a false positive nobody could
    // interpret. See D6.
    const ops = await opsToken();
    const accountId = await account();
    const sent = await card(accountId, { status: "posted" });
    await markReturned(ops, sent.jobId);

    const sibling = await card(accountId, { status: "pending" });

    await request(app.getHttpServer())
      .post("/fulfillment/print-run")
      .set("Authorization", `Bearer ${ops}`)
      .send({ jobIds: [sibling.jobId] })
      .expect(201);
  });

  it("says on the queue row that the card is held", async () => {
    // Phase 1 made these impossible to produce and left them looking completely
    // ordinary — an operator found out by selecting one and reading a refusal.
    const ops = await opsToken();
    const accountId = await account();
    const sent = await card(accountId, { status: "posted" });
    await markReturned(ops, sent.jobId);
    const queued = await card(accountId, { recipientId: sent.recipientId, status: "pending" });
    const ordinary = await card(accountId, { status: "pending" });

    const res = await request(app.getHttpServer())
      .get("/fulfillment/jobs?status=pending&perPage=100")
      .set("Authorization", `Bearer ${ops}`)
      .expect(200);
    const rows = (res.body as { items: { id: string; heldByReturnedAddress: boolean }[] }).items;
    const held = rows.find((row) => row.id === queued.jobId);
    const fine = rows.find((row) => row.id === ordinary.jobId);

    expect(held?.heldByReturnedAddress).toBe(true);
    expect(fine?.heldByReturnedAddress).toBe(false);
  });

  it("narrows the queue to the held cards, across every open status", async () => {
    // A held card can sit at any open status, and an operator asking "what is
    // stuck?" does not know which — so the filter releases the status pin, the
    // way the deadline chips already do.
    const ops = await opsToken();
    const accountId = await account();
    const sent = await card(accountId, { status: "posted" });
    await markReturned(ops, sent.jobId);
    const pendingHeld = await card(accountId, {
      recipientId: sent.recipientId,
      status: "pending",
    });
    const printedHeld = await card(accountId, {
      recipientId: sent.recipientId,
      status: "printed",
    });
    const ordinary = await card(accountId, { status: "pending" });

    const res = await request(app.getHttpServer())
      .get("/fulfillment/jobs?held=only&perPage=100")
      .set("Authorization", `Bearer ${ops}`)
      .expect(200);
    const ids = (res.body as { items: { id: string }[] }).items.map((row) => row.id);

    expect(ids).toEqual(expect.arrayContaining([pendingHeld.jobId, printedHeld.jobId]));
    expect(ids).not.toContain(ordinary.jobId);
    // The card that actually came back is closed, not held — it has been dealt
    // with, and listing it as stuck work would be wrong.
    expect(ids).not.toContain(sent.jobId);
  });

  it("takes held cards out of the ordinary working queue when asked", async () => {
    const ops = await opsToken();
    const accountId = await account();
    const sent = await card(accountId, { status: "posted" });
    await markReturned(ops, sent.jobId);
    const heldCard = await card(accountId, { recipientId: sent.recipientId, status: "pending" });
    const ordinary = await card(accountId, { status: "pending" });

    const res = await request(app.getHttpServer())
      .get("/fulfillment/jobs?held=hide&perPage=100")
      .set("Authorization", `Bearer ${ops}`)
      .expect(200);
    const ids = (res.body as { items: { id: string }[] }).items.map((row) => row.id);

    expect(ids).toContain(ordinary.jobId);
    expect(ids).not.toContain(heldCard.jobId);
  });

  it("counts the held cards so the chip can carry the number", async () => {
    const ops = await opsToken();
    const accountId = await account();
    const before = await request(app.getHttpServer())
      .get("/fulfillment/counts")
      .set("Authorization", `Bearer ${ops}`)
      .expect(200);
    const start = (before.body as { held: number }).held;

    const sent = await card(accountId, { status: "posted" });
    await markReturned(ops, sent.jobId);
    await card(accountId, { recipientId: sent.recipientId, status: "pending" });

    const after = await request(app.getHttpServer())
      .get("/fulfillment/counts")
      .set("Authorization", `Bearer ${ops}`)
      .expect(200);
    expect((after.body as { held: number }).held).toBe(start + 1);
  });

  it("stops chasing an operator to post a card it will not let them post", async () => {
    // Left in, the must-ship band would carry a permanent overdue nobody could
    // ever clear — the surest way to teach a team to ignore the banner.
    const ops = await opsToken();
    const accountId = await account();
    const sent = await card(accountId, { status: "posted" });
    await markReturned(ops, sent.jobId);
    const queued = await card(accountId, { recipientId: sent.recipientId, status: "pending" });
    await prisma.fulfillmentJob.update({
      where: { id: queued.jobId },
      data: { dueDate: new Date(Date.now() - 86_400_000) },
    });

    const summary = await request(app.getHttpServer())
      .get("/fulfillment/must-ship")
      .set("Authorization", `Bearer ${ops}`)
      .expect(200);
    const body = summary.body as { cards: { jobId: string }[]; overdue: number };
    expect(body.cards.map((c) => c.jobId)).not.toContain(queued.jobId);
  });
});
