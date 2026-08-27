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
 * Occasion reconciliation (ADR 0107 → ADR 0119): a "send to segment" bulk send
 * consumes the recipient's matched natural occasion so it isn't sent again from
 * approvals or auto-send. Rather than superseding it with a one-off, the send now
 * *reuses* the natural occasion as its send record — attaching the design and
 * reserving it (queued) into the draft order — so the card keeps the birthday's
 * own date and classification. Opting out (no `reconcile`) leaves the natural
 * occasion untouched and mints a fresh one-off instead. See ADR 0119.
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
    // A real checkout.session.completed / async_payment_succeeded always carries
    // a payment_status; default it to "paid" so card-payment fixtures settle,
    // while a test can pass payment_status explicitly to model an async/unpaid one.
    data: {
      object:
        (type === "checkout.session.completed" ||
          type === "checkout.session.async_payment_succeeded") &&
        dataObject.payment_status === undefined
          ? { payment_status: "paid", ...dataObject }
          : dataObject,
    },
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
  async function addContactWithBirthday(
    token: string,
  ): Promise<{ recipientId: string; occasionId: string }> {
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
    useOccasionDates?: boolean,
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/batch-orders/bulk-send")
      .set("Authorization", `Bearer ${token}`)
      .send({
        savedDesignId,
        recipientIds,
        postageClass: "second_class",
        reconcile,
        useOccasionDates,
      })
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

  it("reuses the matched natural occasion as the send record", async () => {
    const token = await signUp();
    const savedDesignId = await createSavedDesign(token);
    const { recipientId, occasionId } = await addContactWithBirthday(token);

    const batchOrderId = await bulkSend(
      token,
      savedDesignId,
      [recipientId],
      [{ recipientId, occasionId }],
    );

    // The natural occasion itself becomes the send record: reserved (queued)
    // into the draft, carrying the design, still a birthday — not a separate
    // skipped occasion. No superseding one-off is created, so the recipient
    // still has exactly one occasion.
    const reused = await prisma.occasion.findUniqueOrThrow({ where: { id: occasionId } });
    expect(reused.status).toBe("queued");
    expect(reused.savedDesignId).toBe(savedDesignId);
    expect(reused.type).toBe("birthday");
    expect(reused.supersedesOccasionId).toBeNull();
    expect(await prisma.occasion.count({ where: { recipientId } })).toBe(1);

    await settle(batchOrderId).expect(201);
    expect(await occasionStatus(occasionId)).toBe("queued");
  });

  it("leaves the natural occasion alone when reconciliation is opted out", async () => {
    const token = await signUp();
    const savedDesignId = await createSavedDesign(token);
    const { recipientId, occasionId } = await addContactWithBirthday(token);

    // What the composer sends when the toggle is turned off: no `reconcile`, and
    // occasion dating explicitly declined. Both are needed — without the second,
    // the server's default would find the birthday itself and consume it, which
    // is exactly what the sender said not to do.
    const batchOrderId = await bulkSend(token, savedDesignId, [recipientId], undefined, false);
    await settle(batchOrderId).expect(201);

    expect(await occasionStatus(occasionId)).toBe("scheduled");
  });

  it("ignores reconcile entries for recipients not in the send", async () => {
    const token = await signUp();
    const savedDesignId = await createSavedDesign(token);
    const inSend = await addContactWithBirthday(token);
    const trimmed = await addContactWithBirthday(token);

    // Send only to `inSend`, but ask to reconcile both (as if `trimmed` was
    // removed from the composer after seeding). Only `inSend`'s is reused.
    const batchOrderId = await bulkSend(
      token,
      savedDesignId,
      [inSend.recipientId],
      [
        { recipientId: inSend.recipientId, occasionId: inSend.occasionId },
        { recipientId: trimmed.recipientId, occasionId: trimmed.occasionId },
      ],
    );
    await settle(batchOrderId).expect(201);

    expect(await occasionStatus(inSend.occasionId)).toBe("queued");
    expect(await occasionStatus(trimmed.occasionId)).toBe("scheduled");
  });

  it("never reuses an occasion that's already in flight", async () => {
    const token = await signUp();
    const savedDesignId = await createSavedDesign(token);
    const { recipientId, occasionId } = await addContactWithBirthday(token);

    // The natural occasion got sent by another route before this send.
    await prisma.occasion.update({ where: { id: occasionId }, data: { status: "queued" } });

    // Reconcile is still requested, but a queued (in-flight) occasion isn't
    // sendable, so it's ignored: the send falls back to a fresh one-off and the
    // birthday is left exactly as it was.
    const batchOrderId = await bulkSend(
      token,
      savedDesignId,
      [recipientId],
      [{ recipientId, occasionId }],
    );
    await settle(batchOrderId).expect(201);

    expect(await occasionStatus(occasionId)).toBe("queued");
    // A fresh one-off carried the send instead of reusing the in-flight birthday.
    expect(
      await prisma.occasion.count({ where: { recipientId, source: "one_off_campaign" } }),
    ).toBe(1);
  });

  it("is idempotent under a redelivered settlement webhook", async () => {
    const token = await signUp();
    const savedDesignId = await createSavedDesign(token);
    const { recipientId, occasionId } = await addContactWithBirthday(token);

    const batchOrderId = await bulkSend(
      token,
      savedDesignId,
      [recipientId],
      [{ recipientId, occasionId }],
    );
    await settle(batchOrderId).expect(201);
    await settle(batchOrderId).expect(201); // redelivery — no error, no change

    expect(await occasionStatus(occasionId)).toBe("queued");
  });
});
