import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { accountSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import Stripe from "stripe";
import { PrismaService } from "../src/prisma/prisma.service";
import type { EnvConfig } from "../src/config/env.schema";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * A card stores the artwork it was bought with.
 *
 * Reported from production: an account's seven single-card orders rendered each
 * other's messages in the ops print view — one card headed for Cole carried a
 * message to Alex, and another carried two messages overlapping. The account had
 * done nothing unusual: it reused one design per send and edited the message
 * each time, which is what a reusable design invites.
 *
 * `OrderRecipient` stores only `savedDesignId`, and every render path — the ops
 * print run, the PDF engine, the buyer's own order page — reads
 * `savedDesign.document` live. So editing a design retroactively rewrote every
 * order that had ever used it, including cards already paid for and printed.
 *
 * This is phase 1: the snapshot is written, and nothing reads it yet. The
 * reproduction that proves the bug is dead ships with phase 2, where the reads
 * move — so that diff shows a failing test going green rather than a passing
 * one appearing from nowhere. What can be proved today is that every path which
 * creates a card stores what that card says.
 *
 * See docs/order-artwork-plan.md.
 */
function buildStripeEventPayload(type: string, dataObject: Record<string, unknown>): string {
  return JSON.stringify({
    id: `evt_${randomUUID()}`,
    object: "event",
    api_version: "2025-01-01",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type,
    data: { object: { payment_status: "paid", ...dataObject } },
  });
}

/** A one-page card whose inside-right carries a single, identifiable message. */
function documentSaying(message: string) {
  return {
    version: 1 as const,
    pages: [
      { name: "front" as const, elements: [] },
      { name: "inside-left" as const, elements: [] },
      {
        name: "inside-right" as const,
        elements: [
          {
            kind: "text" as const,
            id: "inside-message",
            text: message,
            x: 40,
            y: 40,
            fontFamily: "Helvetica",
            fontSize: 16,
            color: "#1a1a1a",
            rotation: 0,
          },
        ],
      },
    ],
  };
}

/** The text of every text element on a printed card's inside-right face. */
function messagesOn(document: unknown): string[] {
  const pages = (
    document as { pages: { name: string; elements: { kind: string; text?: string }[] }[] }
  ).pages;
  return pages
    .filter((page) => page.name === "inside-right")
    .flatMap((page) => page.elements)
    .filter((element) => element.kind === "text")
    .map((element) => element.text ?? "");
}

describe("A card's stored artwork (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let stripe: Stripe;
  let webhookSecret: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const config = app.get(ConfigService<EnvConfig, true>);
    webhookSecret = config.get("STRIPE_WEBHOOK_SECRET", { infer: true });
    stripe = new Stripe(config.get("STRIPE_SECRET_KEY", { infer: true }));
  });

  afterAll(async () => {
    await app.close();
  });

  function postWebhook(payload: string) {
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    return request(app.getHttpServer())
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(payload);
  }

  async function signUp(): Promise<string> {
    const token = await mintToken(randomUUID());
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Kip ${randomUUID()}` })
      .expect(201);
    accountSchema.parse(response.body);
    return token;
  }

  /** One paid single-card order against a design carrying `message`. */
  async function orderSaying(
    token: string,
    recipientFirstName: string,
    message: string,
  ): Promise<{
    jobId: string;
    savedDesignId: string;
    orderRecipientId: string;
    recipientId: string;
  }> {
    const recipient = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: recipientFirstName,
        lastName: "Bisby",
        addressLine1: "1 Test Street",
        addressCity: "Hull",
        addressPostcode: "HU1 1AA",
      })
      .expect(201);
    const recipientId = (recipient.body as { id: string }).id;

    const templates = await request(app.getHttpServer())
      .get("/card-designs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const cardDesignId = (templates.body as { id: string }[])[0]!.id;

    const design = await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({ cardDesignId, name: "Happy Tulips copy", document: documentSaying(message) })
      .expect(201);
    const savedDesignId = (design.body as { id: string }).id;

    const occasion = await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "birthday", occasionDate: "2027-09-01", recipientId })
      .expect(201);
    const occasionId = (occasion.body as { id: string }).id;
    await request(app.getHttpServer())
      .post(`/occasions/${occasionId}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ savedDesignId })
      .expect(201);

    const order = await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        lines: [
          {
            occasionId,
            shippingAddressLine1: "1 Test Street",
            shippingAddressCity: "Hull",
            shippingAddressPostcode: "HU1 1AA",
            dispatchOption: "asap",
            postageClass: "first_class",
          },
        ],
      })
      .expect(201);
    const batchOrderId = (order.body as { id: string }).id;

    await prisma.batchOrder.update({
      where: { id: batchOrderId },
      data: { status: "pending_payment", paymentMethod: "card" },
    });
    await postWebhook(
      buildStripeEventPayload("checkout.session.completed", {
        id: `cs_test_${randomUUID()}`,
        metadata: { batchOrderId },
      }),
    ).expect(201);

    const orderRecipient = await prisma.orderRecipient.findFirstOrThrow({
      where: { batchOrderId },
    });
    const job = await prisma.fulfillmentJob.findFirstOrThrow({
      where: { orderRecipientId: orderRecipient.id },
    });
    return {
      jobId: job.id,
      savedDesignId,
      orderRecipientId: orderRecipient.id,
      recipientId,
    };
  }

  it("stores the design document on the card when the order is created", async () => {
    const token = await signUp();
    const elise = await orderSaying(token, "Elise", "To Elise\n\nHave a lovely day,");

    const line = await prisma.orderRecipient.findFirstOrThrow({
      where: { id: elise.orderRecipientId },
      select: { documentSnapshot: true, savedDesignId: true },
    });
    expect(messagesOn(line.documentSnapshot)).toEqual(["To Elise\n\nHave a lovely day,"]);
    // The design id stays for provenance — which design was this? — and for the
    // ops re-sync. It is no longer what decides the print.
    expect(line.savedDesignId).toBe(elise.savedDesignId);
  });

  it("keeps that copy when the design is edited afterwards", async () => {
    const token = await signUp();
    const elise = await orderSaying(token, "Elise", "To Elise\n\nHave a lovely day,");

    await request(app.getHttpServer())
      .patch(`/saved-designs/${elise.savedDesignId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ document: documentSaying("To Florence\n\nHave a lovely day,") })
      .expect(200);

    const line = await prisma.orderRecipient.findFirstOrThrow({
      where: { id: elise.orderRecipientId },
      select: { documentSnapshot: true },
    });
    // The stored copy is untouched. What *renders* still reads the design until
    // phase 2 — that is the next commit, not a gap in this one.
    expect(messagesOn(line.documentSnapshot)).toEqual(["To Elise\n\nHave a lovely day,"]);
  });

  it("gives a returned card's reprint the card that was sent, not the design", async () => {
    const token = await signUp();
    const cole = await orderSaying(token, "Cole", "To Cole\n\nGood luck at college,");

    // The card goes out, comes back, and is recovered to a corrected address —
    // by which time the account has reused the design for somebody else.
    await prisma.fulfillmentJob.update({
      where: { id: cole.jobId },
      data: { status: "returned_to_sender" },
    });
    const { batchOrder } = await prisma.orderRecipient.findFirstOrThrow({
      where: { id: cole.orderRecipientId },
      select: { batchOrder: { select: { accountId: true } } },
    });
    const returnCase = await prisma.returnCase.create({
      data: {
        accountId: batchOrder.accountId,
        orderRecipientId: cole.orderRecipientId,
        recipientId: cole.recipientId,
        reason: "incorrect_address",
        markedByUserId: randomUUID(),
        // The customer has already supplied a corrected address, so the case is
        // at the step where a resend is the next action.
        status: "awaiting_resend",
      },
    });
    await request(app.getHttpServer())
      .patch(`/saved-designs/${cole.savedDesignId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ document: documentSaying("To Alex\n\nGood luck at college,") })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/returns/${returnCase.id}/resend`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    // Recovering a returned card is precisely when you want the same card
    // again — weeks later, with the design long since moved on.
    const recovery = await prisma.orderRecipient.findFirstOrThrow({
      where: { recipientId: cole.recipientId, id: { not: cole.orderRecipientId } },
      select: { documentSnapshot: true },
    });
    expect(messagesOn(recovery.documentSnapshot)).toEqual(["To Cole\n\nGood luck at college,"]);
  });

  it("gives a returned card's reprint the QR destination that was chosen too", async () => {
    // The reprint copied the occasion, the design and the snapshot, and dropped
    // `messagePageId` — it was not even selected. Settlement then read null,
    // fell into its auto-page branch, and minted a fresh page titled "Your
    // message". So the replacement card carried a perfectly scannable code to a
    // page the sender never wrote, for the one recipient most certain to scan
    // it, because this is the card that finally arrived.
    const token = await signUp();
    const nadia = await orderSaying(token, "Nadia", "To Nadia\n\nWelcome to the team,");

    const { batchOrder } = await prisma.orderRecipient.findFirstOrThrow({
      where: { id: nadia.orderRecipientId },
      select: { batchOrder: { select: { accountId: true } } },
    });
    // The page the sender actually curated — a title they wrote, not the default.
    const chosen = await prisma.messagePage.create({
      data: { accountId: batchOrder.accountId, title: "Nadia's first day" },
    });
    await prisma.orderRecipient.update({
      where: { id: nadia.orderRecipientId },
      data: { messagePageId: chosen.id },
    });

    await prisma.fulfillmentJob.update({
      where: { id: nadia.jobId },
      data: { status: "returned_to_sender" },
    });
    const returnCase = await prisma.returnCase.create({
      data: {
        accountId: batchOrder.accountId,
        orderRecipientId: nadia.orderRecipientId,
        recipientId: nadia.recipientId,
        reason: "incorrect_address",
        markedByUserId: randomUUID(),
        status: "awaiting_resend",
      },
    });

    await request(app.getHttpServer())
      .post(`/returns/${returnCase.id}/resend`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    const recovery = await prisma.orderRecipient.findFirstOrThrow({
      where: { recipientId: nadia.recipientId, id: { not: nadia.orderRecipientId } },
      select: { id: true, messagePageId: true },
    });
    expect(recovery.messagePageId).toBe(chosen.id);

    // And the link settlement minted points at that page, not a new one — a
    // fresh slug per card, the same destination behind it.
    const link = await prisma.messagePageLink.findFirstOrThrow({
      where: { orderRecipientId: recovery.id },
      select: { messagePageId: true, slug: true },
    });
    expect(link.messagePageId).toBe(chosen.id);
    expect(link.slug).toBeTruthy();
  });
});
