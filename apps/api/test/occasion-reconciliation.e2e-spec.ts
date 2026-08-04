import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { App } from "supertest/types";
import request from "supertest";
import Stripe from "stripe";
import { PrismaService } from "../src/prisma/prisma.service";
import type { EnvConfig } from "../src/config/env.schema";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * Occasion reconciliation (ADR 0107): a "send to segment" bulk send can consume
 * the recipient's matched natural occasion so it isn't sent again from approvals
 * or auto-send. The consume happens at payment settlement — never at draft time —
 * so an abandoned checkout never wrongly skips a real birthday. See ADR 0107.
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
    data: { object: dataObject },
  });
}

describe("Occasion reconciliation (e2e)", () => {
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

  async function signUp(): Promise<string> {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Recon ${randomUUID()}` })
      .expect(201);
    return token;
  }

  /** A mailable contact with a birthday → creates its natural birthday occasion. */
  async function addContactWithBirthday(token: string): Promise<{ recipientId: string; occasionId: string }> {
    const res = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: "Birthday",
        lastName: randomUUID().slice(0, 8),
        dateOfBirth: "2015-06-15",
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
      })
      .expect(201);
    const recipientId = (res.body as { id: string }).id;
    const occasion = await prisma.occasion.findFirstOrThrow({
      where: { recipientId, type: "birthday" },
    });
    return { recipientId, occasionId: occasion.id };
  }

  async function createSavedDesign(token: string): Promise<string> {
    const templates = await request(app.getHttpServer())
      .get("/card-designs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const cardDesignId = (templates.body as { id: string }[])[0]!.id;
    const res = await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({ cardDesignId, name: "Recon design" })
      .expect(201);
    return (res.body as { id: string }).id;
  }

  /** Bulk-send the design to the recipients, optionally reconciling occasions,
   * then drive it to `pending_payment` (as checkout would) ready for the webhook. */
  async function bulkSend(
    token: string,
    savedDesignId: string,
    recipientIds: string[],
    reconcile?: { recipientId: string; occasionId: string }[],
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/batch-orders/bulk-send")
      .set("Authorization", `Bearer ${token}`)
      .send({ savedDesignId, recipientIds, postageClass: "second_class", reconcile })
      .expect(201);
    const batchOrderId = (res.body as { id: string }).id;
    await prisma.batchOrder.update({
      where: { id: batchOrderId },
      data: { status: "pending_payment", paymentMethod: "card" },
    });
    return batchOrderId;
  }

  function settle(batchOrderId: string) {
    const payload = buildStripeEventPayload("checkout.session.completed", {
      id: `cs_test_${randomUUID()}`,
      metadata: { batchOrderId },
    });
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret });
    return request(app.getHttpServer())
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(payload);
  }

  async function occasionStatus(id: string): Promise<string> {
    return (await prisma.occasion.findUniqueOrThrow({ where: { id } })).status;
  }

  it("skips the matched natural occasion once the segment send is paid", async () => {
    const token = await signUp();
    const savedDesignId = await createSavedDesign(token);
    const { recipientId, occasionId } = await addContactWithBirthday(token);

    const batchOrderId = await bulkSend(token, savedDesignId, [recipientId], [
      { recipientId, occasionId },
    ]);
    // Not consumed until it's actually paid.
    expect(await occasionStatus(occasionId)).toBe("scheduled");

    await settle(batchOrderId).expect(201);
    expect(await occasionStatus(occasionId)).toBe("skipped");
  });

  it("leaves the natural occasion alone when reconciliation is opted out", async () => {
    const token = await signUp();
    const savedDesignId = await createSavedDesign(token);
    const { recipientId, occasionId } = await addContactWithBirthday(token);

    // No `reconcile` — the current default-off-at-API behaviour (the toggle sends none).
    const batchOrderId = await bulkSend(token, savedDesignId, [recipientId]);
    await settle(batchOrderId).expect(201);

    expect(await occasionStatus(occasionId)).toBe("scheduled");
  });

  it("ignores reconcile entries for recipients not in the send", async () => {
    const token = await signUp();
    const savedDesignId = await createSavedDesign(token);
    const inSend = await addContactWithBirthday(token);
    const trimmed = await addContactWithBirthday(token);

    // Send only to `inSend`, but ask to reconcile both (as if `trimmed` was
    // removed from the composer after seeding). Only `inSend`'s is consumed.
    const batchOrderId = await bulkSend(token, savedDesignId, [inSend.recipientId], [
      { recipientId: inSend.recipientId, occasionId: inSend.occasionId },
      { recipientId: trimmed.recipientId, occasionId: trimmed.occasionId },
    ]);
    await settle(batchOrderId).expect(201);

    expect(await occasionStatus(inSend.occasionId)).toBe("skipped");
    expect(await occasionStatus(trimmed.occasionId)).toBe("scheduled");
  });

  it("never un-does an occasion that's already in flight", async () => {
    const token = await signUp();
    const savedDesignId = await createSavedDesign(token);
    const { recipientId, occasionId } = await addContactWithBirthday(token);

    const batchOrderId = await bulkSend(token, savedDesignId, [recipientId], [
      { recipientId, occasionId },
    ]);
    // The natural occasion got sent by another route between draft and payment.
    await prisma.occasion.update({ where: { id: occasionId }, data: { status: "queued" } });

    await settle(batchOrderId).expect(201);
    // Status-guarded: a queued (paid/sent) occasion is left as-is.
    expect(await occasionStatus(occasionId)).toBe("queued");
  });

  it("is idempotent under a redelivered settlement webhook", async () => {
    const token = await signUp();
    const savedDesignId = await createSavedDesign(token);
    const { recipientId, occasionId } = await addContactWithBirthday(token);

    const batchOrderId = await bulkSend(token, savedDesignId, [recipientId], [
      { recipientId, occasionId },
    ]);
    await settle(batchOrderId).expect(201);
    await settle(batchOrderId).expect(201); // redelivery — no error, no change

    expect(await occasionStatus(occasionId)).toBe("skipped");
  });
});
