import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import { accountSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import Stripe from "stripe";
import { PrismaService } from "../src/prisma/prisma.service";
import type { EnvConfig } from "../src/config/env.schema";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

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

describe("Messages (e2e)", () => {
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

  async function signUp(): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID());
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Test Centre ${randomUUID()}` })
      .expect(201);
    return { token, accountId: accountSchema.parse(response.body).id };
  }

  /**
   * Drives the full flow up to a paid order so its message pages exist:
   * recipient -> design -> occasion -> approve -> batch order ->
   * pending_payment -> checkout.session.completed webhook.
   */
  async function createPaidOrder(
    token: string,
    recipientFirstName = "Sam",
    designVideoUrl?: string,
  ): Promise<{ batchOrderId: string }> {
    const recipientResponse = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({ firstName: recipientFirstName, lastName: "Recipient" })
      .expect(201);
    const recipientId = (recipientResponse.body as { id: string }).id;

    const templatesResponse = await request(app.getHttpServer())
      .get("/card-designs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const cardDesignId = (templatesResponse.body as { id: string }[])[0]!.id;
    const designResponse = await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({ cardDesignId, name: "Test design" })
      .expect(201);
    const savedDesignId = (designResponse.body as { id: string }).id;

    if (designVideoUrl) {
      // Set the design's default video (the field the card designer writes).
      const current = await prisma.savedDesign.findUniqueOrThrow({
        where: { id: savedDesignId },
        select: { document: true },
      });
      await prisma.savedDesign.update({
        where: { id: savedDesignId },
        data: {
          document: { ...(current.document as Prisma.JsonObject), videoUrl: designVideoUrl },
        },
      });
    }

    const occasionResponse = await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "birthday", occasionDate: "2026-09-01", recipientId })
      .expect(201);
    const occasionId = (occasionResponse.body as { id: string }).id;
    await request(app.getHttpServer())
      .post(`/occasions/${occasionId}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ savedDesignId })
      .expect(201);

    const orderResponse = await request(app.getHttpServer())
      .post("/batch-orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        lines: [
          {
            occasionId,
            shippingAddressLine1: "1 Test Street",
            shippingAddressCity: "London",
            shippingAddressPostcode: "SW1A 1AA",
            dispatchOption: "asap",
            postageClass: "first_class",
          },
        ],
      })
      .expect(201);
    const batchOrderId = (orderResponse.body as { id: string }).id;

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

    return { batchOrderId };
  }

  it("lists an account's message pages (video seeded from the design) and personalises one", async () => {
    const { token } = await signUp();
    const seededVideo = "https://youtu.be/dQw4w9WgXcQ";
    await createPaidOrder(token, "Ada", seededVideo);

    const listResponse = await request(app.getHttpServer())
      .get("/messages")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const pages = listResponse.body as {
      id: string;
      slug: string;
      message: string | null;
      videoUrl: string | null;
      viewCount: number;
    }[];
    expect(pages).toHaveLength(1);
    expect(pages[0]!.message).toBeNull();
    // The design's default video is copied onto each recipient's page at order time.
    expect(pages[0]!.videoUrl).toBe(seededVideo);
    const pageId = pages[0]!.id;

    const updateResponse = await request(app.getHttpServer())
      .patch(`/messages/${pageId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ message: "Happy birthday!", emoji: "🎉" })
      .expect(200);
    expect((updateResponse.body as { message: string }).message).toBe("Happy birthday!");
    expect((updateResponse.body as { emoji: string }).emoji).toBe("🎉");
  });

  it("serves a message page publicly by slug and increments its view count", async () => {
    const { token } = await signUp();
    await createPaidOrder(token, "Grace");
    const page = await prisma.messagePage.findFirstOrThrow({
      where: { orderRecipient: { batchOrder: { account: { name: { contains: "Test Centre" } } } } },
      orderBy: { createdAt: "desc" },
    });
    await prisma.messagePage.update({
      where: { id: page.id },
      data: { message: "You did it!" },
    });

    // No Authorization header — this is the public QR-code target.
    const viewResponse = await request(app.getHttpServer())
      .get(`/messages/${page.slug}`)
      .expect(200);
    expect(viewResponse.body).toEqual({
      message: "You did it!",
      emoji: null,
      videoUrl: null,
      recipientFirstName: "Grace",
      occasionType: "birthday",
    });

    await request(app.getHttpServer()).get(`/messages/${page.slug}`).expect(200);

    const refreshed = await prisma.messagePage.findUniqueOrThrow({ where: { id: page.id } });
    expect(refreshed.viewCount).toBe(2);
  });

  it("returns 404 for an unknown slug", async () => {
    await request(app.getHttpServer()).get("/messages/doesnotexist").expect(404);
  });

  it("rejects personalising a message page belonging to another account", async () => {
    const owner = await signUp();
    await createPaidOrder(owner.token, "Owner");
    const listResponse = await request(app.getHttpServer())
      .get("/messages")
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);
    const pageId = (listResponse.body as { id: string }[])[0]!.id;

    const other = await signUp();
    await request(app.getHttpServer())
      .patch(`/messages/${pageId}`)
      .set("Authorization", `Bearer ${other.token}`)
      .send({ message: "hijacked" })
      .expect(404);

    // Other account sees none of the owner's pages.
    const otherList = await request(app.getHttpServer())
      .get("/messages")
      .set("Authorization", `Bearer ${other.token}`)
      .expect(200);
    expect(otherList.body).toHaveLength(0);
  });
});
