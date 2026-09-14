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
 * What a paid order prints must be what was bought.
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
 * ADR 0158 already decided the neighbouring half of this: a design referenced by
 * an order can't be deleted, because that would "break that immutable history".
 * The history was never immutable — only undeletable.
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

describe("A paid order's artwork (e2e)", () => {
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

  async function createOpsAdmin(): Promise<string> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId } });
    return mintToken(userId);
  }

  /** One paid single-card order against a design carrying `message`. */
  async function orderSaying(
    token: string,
    recipientFirstName: string,
    message: string,
  ): Promise<{ jobId: string; savedDesignId: string }> {
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
      .send({ type: "birthday", occasionDate: "2026-09-01", recipientId })
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
    return { jobId: job.id, savedDesignId };
  }

  function printRun(opsToken: string, jobIds: string[]) {
    return request(app.getHttpServer())
      .post("/fulfillment/print-run")
      .set("Authorization", `Bearer ${opsToken}`)
      .send({ jobIds })
      .expect(201);
  }

  it("keeps the message it was bought with when the design is edited afterwards", async () => {
    const opsToken = await createOpsAdmin();
    const token = await signUp();
    const elise = await orderSaying(token, "Elise", "To Elise\n\nHave a lovely day,");

    // What ops would print today.
    const before = await printRun(opsToken, [elise.jobId]);
    expect(messagesOn((before.body as { document: unknown }[])[0]!.document)).toEqual([
      "To Elise\n\nHave a lovely day,",
    ]);

    // The account reuses the design for the next card, as the library invites.
    await request(app.getHttpServer())
      .patch(`/saved-designs/${elise.savedDesignId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ document: documentSaying("To Florence\n\nHave a lovely day,") })
      .expect(200);

    // Elise's card was paid for. It must still say what it said.
    const after = await printRun(opsToken, [elise.jobId]);
    expect(messagesOn((after.body as { document: unknown }[])[0]!.document)).toEqual([
      "To Elise\n\nHave a lovely day,",
    ]);
  });

  it("does not gain a second message when one is added to the design later", async () => {
    const opsToken = await createOpsAdmin();
    const token = await signUp();
    const cole = await orderSaying(token, "Cole", "To Cole\n\nGood luck at college,");

    // The editor's Duplicate offsets a copy "so both are visible" — which is how
    // a second message ends up on one face while the first is still there.
    const original = documentSaying("To Cole\n\nGood luck at college,");
    const duplicated = documentSaying("To Alex\n\nGood luck at college,");
    const twoMessages = {
      ...original,
      pages: original.pages.map((page) =>
        page.name === "inside-right"
          ? {
              ...page,
              elements: [
                ...page.elements,
                // Offset down-right, exactly as duplicateSelected() places it.
                ...duplicated.pages[2]!.elements.map((element) => ({
                  ...element,
                  id: randomUUID(),
                  x: element.x + 20,
                  y: element.y + 20,
                })),
              ],
            }
          : page,
      ),
    };
    await request(app.getHttpServer())
      .patch(`/saved-designs/${cole.savedDesignId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ document: twoMessages })
      .expect(200);

    const after = await printRun(opsToken, [cole.jobId]);
    expect(messagesOn((after.body as { document: unknown }[])[0]!.document)).toEqual([
      "To Cole\n\nGood luck at college,",
    ]);
  });
});
