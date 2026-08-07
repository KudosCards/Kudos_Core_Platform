import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { accountSchema, messagePageDetailSchema, messagePageSummarySchema } from "@kudos/shared-types";
import { z } from "zod";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

describe("Message Pages library (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  /** A new account is on the free plan; upgrade to unlock message-page authoring. */
  async function signUp(plan: "free" | "pro" = "pro"): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID());
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Test Centre ${randomUUID()}` })
      .expect(201);
    const accountId = accountSchema.parse(response.body).id;
    if (plan !== "free") {
      await prisma.account.update({ where: { id: accountId }, data: { planId: plan } });
    }
    return { token, accountId };
  }

  it("refuses page authoring on the free plan", async () => {
    const { token } = await signUp("free");
    await request(app.getHttpServer())
      .post("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Blocked" })
      .expect(403);
  });

  it("creates a page with a standalone QR link and serves it publicly", async () => {
    const { token } = await signUp();
    const createResponse = await request(app.getHttpServer())
      .post("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "From the manager", recipientName: "Team" })
      .expect(201);
    const page = messagePageDetailSchema.parse(createResponse.body);

    expect(page.title).toBe("From the manager");
    expect(page.videoType).toBe("none");
    expect(page.embedUrl).toBeNull();
    expect(page.linkCount).toBe(1); // the standalone QR minted on create
    expect(page.totalViews).toBe(0);
    expect(page.primarySlug).not.toBeNull();

    // The standalone slug is immediately a working public QR target, greeting
    // the page's manual recipientName since there's no linked contact.
    const view = await request(app.getHttpServer())
      .get(`/messages/${page.primarySlug}`)
      .expect(200);
    expect((view.body as { recipientFirstName: string }).recipientFirstName).toBe("Team");
  });

  it("parses a video link to an embed and rejects an unsupported one", async () => {
    const { token } = await signUp();
    const ok = await request(app.getHttpServer())
      .post("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "With video", videoUrl: "https://youtu.be/HgzGwKwLmgM" })
      .expect(201);
    const page = messagePageDetailSchema.parse(ok.body);
    expect(page.videoType).toBe("embed");
    expect(page.videoProvider).toBe("youtube");
    expect(page.embedUrl).toBe("https://www.youtube-nocookie.com/embed/HgzGwKwLmgM");

    await request(app.getHttpServer())
      .post("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Bad video", videoUrl: "https://example.com/not-a-video" })
      .expect(400);
  });

  it("rejects a half-specified call-to-action", async () => {
    const { token } = await signUp();
    await request(app.getHttpServer())
      .post("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "CTA", ctaLabel: "Visit us" })
      .expect(400);
  });

  it("sanitises the message HTML on the way in", async () => {
    const { token } = await signUp();
    const response = await request(app.getHttpServer())
      .post("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Sanitised",
        message: "<p>Hello <b>friend</b></p><script>alert('xss')</script>",
      })
      .expect(201);
    const page = messagePageDetailSchema.parse(response.body);
    expect(page.message).toBe("<p>Hello <b>friend</b></p>");
    expect(page.hasMessage).toBe(true);
  });

  it("lists, fetches, updates and archives a page — scoped to its account", async () => {
    const owner = await signUp();
    const created = await request(app.getHttpServer())
      .post("/message-pages")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ title: "Original", message: "<p>hi</p>" })
      .expect(201);
    const id = messagePageDetailSchema.parse(created.body).id;

    const listResponse = await request(app.getHttpServer())
      .get("/message-pages")
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);
    const pages = z.array(messagePageSummarySchema).parse(listResponse.body);
    expect(pages.some((p) => p.id === id && p.title === "Original")).toBe(true);

    // Update: rename, attach a video, clear the message.
    const updated = await request(app.getHttpServer())
      .patch(`/message-pages/${id}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ title: "Renamed", videoUrl: "https://vimeo.com/76979871", message: null })
      .expect(200);
    const detail = messagePageDetailSchema.parse(updated.body);
    expect(detail.title).toBe("Renamed");
    expect(detail.videoProvider).toBe("vimeo");
    expect(detail.message).toBeNull();
    expect(detail.hasMessage).toBe(false);

    // Another account can neither see, fetch nor mutate it.
    const other = await signUp();
    await request(app.getHttpServer())
      .get(`/message-pages/${id}`)
      .set("Authorization", `Bearer ${other.token}`)
      .expect(404);
    await request(app.getHttpServer())
      .patch(`/message-pages/${id}`)
      .set("Authorization", `Bearer ${other.token}`)
      .send({ title: "hijack" })
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/message-pages/${id}`)
      .set("Authorization", `Bearer ${other.token}`)
      .expect(404);

    // Owner archives it (soft-delete); it reads back as archived.
    await request(app.getHttpServer())
      .delete(`/message-pages/${id}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(204);
    const afterArchive = await request(app.getHttpServer())
      .get(`/message-pages/${id}`)
      .set("Authorization", `Bearer ${owner.token}`)
      .expect(200);
    expect(messagePageDetailSchema.parse(afterArchive.body).status).toBe("archived");
  });

  it("keeps reads open but blocks authoring after a downgrade to free", async () => {
    const { token, accountId } = await signUp();
    const created = await request(app.getHttpServer())
      .post("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Made on pro" })
      .expect(201);
    const id = messagePageDetailSchema.parse(created.body).id;

    await prisma.account.update({ where: { id: accountId }, data: { planId: "free" } });

    // Read still works…
    await request(app.getHttpServer())
      .get(`/message-pages/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    // …authoring does not.
    await request(app.getHttpServer())
      .patch(`/message-pages/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "changed" })
      .expect(403);
  });
});
