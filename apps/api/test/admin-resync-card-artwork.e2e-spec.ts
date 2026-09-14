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
 * The escape hatch phase 2 owes ops.
 *
 * Editing a design used to reach every order that had ever used it — the
 * defect — and it was also how a wrong card got corrected before printing.
 * Taking the first away without replacing the second would leave an operator
 * looking at a card they can see is wrong and no way to fix it.
 *
 * So the correction stays, and is now deliberate: one card, by a super admin,
 * in the audit log, and refused once ink is on paper.
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

describe("Correcting a card's artwork (e2e)", () => {
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

  async function createOpsAdmin(role: "super_admin" | "ops" = "super_admin"): Promise<string> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId, role } });
    return mintToken(userId);
  }

  function resync(token: string, orderRecipientId: string) {
    return request(app.getHttpServer())
      .post(`/admin/cards/${orderRecipientId}/resync-artwork`)
      .set("Authorization", `Bearer ${token}`);
  }

  interface ResyncBody {
    changed: boolean;
    recipientName: string;
    savedDesignName: string;
  }

  it("pulls the corrected design onto a card that has not been printed", async () => {
    const opsToken = await createOpsAdmin();
    const token = await signUp();
    const cole = await orderSaying(token, "Cole", "To Alex\n\nGood luck at college,");

    // Exactly the production case: the card is wrong, and the way to fix it is
    // to correct the design and pull it onto this card.
    await request(app.getHttpServer())
      .patch(`/saved-designs/${cole.savedDesignId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ document: documentSaying("To Cole\n\nGood luck at college,") })
      .expect(200);

    const response = await resync(opsToken, cole.orderRecipientId).expect(201);
    expect((response.body as ResyncBody).changed).toBe(true);
    expect((response.body as ResyncBody).recipientName).toBe("Cole Bisby");

    const line = await prisma.orderRecipient.findFirstOrThrow({
      where: { id: cole.orderRecipientId },
      select: { documentSnapshot: true },
    });
    expect(messagesOn(line.documentSnapshot)).toEqual(["To Cole\n\nGood luck at college,"]);
  });

  it("says when nothing moved, rather than reporting a change that did nothing", async () => {
    const opsToken = await createOpsAdmin();
    const token = await signUp();
    const elise = await orderSaying(token, "Elise", "To Elise\n\nHave a lovely day,");

    const response = await resync(opsToken, elise.orderRecipientId).expect(201);
    expect((response.body as ResyncBody).changed).toBe(false);
  });

  it("records who corrected which card, and from which design", async () => {
    const opsToken = await createOpsAdmin();
    const token = await signUp();
    const cole = await orderSaying(token, "Cole", "To Alex\n\nGood luck at college,");

    await resync(opsToken, cole.orderRecipientId).expect(201);

    const entry = await prisma.auditLogEntry.findFirstOrThrow({
      where: { action: "card_artwork_resynced", targetId: cole.orderRecipientId },
    });
    expect(entry.targetType).toBe("OrderRecipient");
    expect(entry.metadata).toMatchObject({
      savedDesignId: cole.savedDesignId,
      savedDesignName: "Happy Tulips copy",
    });
  });

  it("refuses once ink is on paper", async () => {
    const opsToken = await createOpsAdmin();
    const token = await signUp();
    const cole = await orderSaying(token, "Cole", "To Alex\n\nGood luck at college,");

    // `in_progress` is still safe — the queue's own next action from there is
    // "Mark printed", so the sheet has not been run.
    await prisma.fulfillmentJob.update({
      where: { id: cole.jobId },
      data: { status: "in_progress" },
    });
    await resync(opsToken, cole.orderRecipientId).expect(201);

    for (const status of ["printed", "posted", "delivered"] as const) {
      await prisma.fulfillmentJob.update({ where: { id: cole.jobId }, data: { status } });
      const refused = await resync(opsToken, cole.orderRecipientId).expect(409);
      expect((refused.body as { message: string }).message).toMatch(/before it is printed/i);
    }
  });

  it("is super-admin only, and 404s on a card that is not there", async () => {
    const ops = await createOpsAdmin("ops");
    const superAdmin = await createOpsAdmin();
    const token = await signUp();
    const cole = await orderSaying(token, "Cole", "To Alex\n\nGood luck at college,");

    await resync(ops, cole.orderRecipientId).expect(403);
    await resync(superAdmin, randomUUID()).expect(404);
  });
});
