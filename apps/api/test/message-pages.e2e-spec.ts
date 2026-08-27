import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import {
  accountSchema,
  messagePageAccountInsightsSchema,
  messagePageDetailSchema,
  messagePageInsightsSchema,
  messagePageReplySchema,
  messagePageSummarySchema,
  messagePageTimeSeriesSchema,
} from "@kudos/shared-types";
import { z } from "zod";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { MessagePageEventsRetentionService } from "../src/messages/message-page-events-retention.service";
import { EMAIL_CLIENT } from "../src/email/email.client";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

// Arm engagement-event capture for this suite (ADR 0136, Phase 2). Set before
// the app boots so ConfigModule validates it on; cleaned up in afterAll.
process.env.MESSAGE_EVENTS_ENABLED = "true";

describe("Message Pages library (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let sendTransactional: jest.Mock;

  beforeAll(async () => {
    sendTransactional = jest.fn().mockResolvedValue(undefined);
    app = await createTestApp([{ provide: EMAIL_CLIENT, useValue: { sendTransactional } }]);
    prisma = app.get(PrismaService);
  });

  beforeEach(() => sendTransactional.mockClear());

  afterAll(async () => {
    delete process.env.MESSAGE_EVENTS_ENABLED;
    await app.close();
  });

  /** A new account is on the free plan; upgrade to unlock message-page authoring. */
  async function signUp(
    plan: "free" | "pro" = "pro",
  ): Promise<{ token: string; accountId: string }> {
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

  it("accepts a public reply, notifies the account, and reads/clears it on the dashboard", async () => {
    const { token, accountId } = await signUp();
    // A contact email so the reply notification also goes out by email.
    await prisma.account.update({
      where: { id: accountId },
      data: { contactEmail: "owner@centre.test" },
    });
    const created = await request(app.getHttpServer())
      .post("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Say hi back", allowReplies: true })
      .expect(201);
    const page = messagePageDetailSchema.parse(created.body);
    const slug = page.primarySlug!;

    // The public page invites a reply (allowReplies surfaced).
    const view = await request(app.getHttpServer()).get(`/messages/${slug}`).expect(200);
    expect((view.body as { allowReplies: boolean }).allowReplies).toBe(true);

    // A recipient writes back (anonymous, no auth) — accepted (202).
    await request(app.getHttpServer())
      .post(`/messages/${slug}/replies`)
      .send({ senderName: "Jo", body: "Loved it, thank you!" })
      .expect(202);

    // The account was notified in its inbox…
    const notification = await prisma.notification.findFirst({
      where: { accountId, kind: "message_reply" },
    });
    expect(notification).not.toBeNull();
    // …and by email to its contact.
    expect(sendTransactional).toHaveBeenCalledTimes(1);
    expect((sendTransactional.mock.calls[0] as [{ to: string }])[0].to).toBe("owner@centre.test");

    // The library shows the unread reply on the page's badge.
    const listBefore = await request(app.getHttpServer())
      .get("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const summaryBefore = z
      .array(messagePageSummarySchema)
      .parse(listBefore.body)
      .find((p) => p.id === page.id);
    expect(summaryBefore).toMatchObject({ replyCount: 1, unreadReplies: 1 });

    // The dashboard lists the reply (unread), then marking read clears it.
    const repliesResponse = await request(app.getHttpServer())
      .get(`/message-pages/${page.id}/replies`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const replies = z.array(messagePageReplySchema).parse(repliesResponse.body);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({
      senderName: "Jo",
      body: "Loved it, thank you!",
      readAt: null,
    });

    await request(app.getHttpServer())
      .post(`/message-pages/${page.id}/replies/read`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);

    const listAfter = await request(app.getHttpServer())
      .get("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const summaryAfter = z
      .array(messagePageSummarySchema)
      .parse(listAfter.body)
      .find((p) => p.id === page.id);
    expect(summaryAfter).toMatchObject({ replyCount: 1, unreadReplies: 0 });
  });

  it("rejects a reply on a page that hasn't enabled them, and 404s an unknown slug", async () => {
    const { token } = await signUp();
    const created = await request(app.getHttpServer())
      .post("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "No replies here" })
      .expect(201);
    const slug = messagePageDetailSchema.parse(created.body).primarySlug!;

    await request(app.getHttpServer())
      .post(`/messages/${slug}/replies`)
      .send({ body: "hello?" })
      .expect(403);

    await request(app.getHttpServer())
      .post("/messages/doesnotexist/replies")
      .send({ body: "hello?" })
      .expect(404);
  });

  it("won't list another account's replies", async () => {
    const owner = await signUp();
    const created = await request(app.getHttpServer())
      .post("/message-pages")
      .set("Authorization", `Bearer ${owner.token}`)
      .send({ title: "Private", allowReplies: true })
      .expect(201);
    const pageId = messagePageDetailSchema.parse(created.body).id;

    const other = await signUp();
    await request(app.getHttpServer())
      .get(`/message-pages/${pageId}/replies`)
      .set("Authorization", `Bearer ${other.token}`)
      .expect(404);
  });

  it("counts a CTA click and redirects to the target", async () => {
    const { token } = await signUp();
    const created = await request(app.getHttpServer())
      .post("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Come to the party", ctaLabel: "RSVP", ctaUrl: "https://example.com/rsvp" })
      .expect(201);
    const page = messagePageDetailSchema.parse(created.body);
    const slug = page.primarySlug!;

    // The public click routes through the tracker → 302 to the CTA target.
    const redirect = await request(app.getHttpServer()).get(`/messages/${slug}/cta`).expect(302);
    expect(redirect.headers.location).toBe("https://example.com/rsvp");

    // The click is rolled up onto the library summary.
    const list = await request(app.getHttpServer())
      .get("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const summary = z
      .array(messagePageSummarySchema)
      .parse(list.body)
      .find((p) => p.id === page.id);
    expect(summary?.totalCtaClicks).toBe(1);

    // A page with no CTA 404s rather than redirecting anywhere.
    const noCta = await request(app.getHttpServer())
      .post("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "No button" })
      .expect(201);
    const noCtaSlug = messagePageDetailSchema.parse(noCta.body).primarySlug!;
    await request(app.getHttpServer()).get(`/messages/${noCtaSlug}/cta`).expect(404);
  });

  it("reports the engagement funnel per page and across the account", async () => {
    const { token } = await signUp();
    const created = await request(app.getHttpServer())
      .post("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Party",
        allowReplies: true,
        ctaLabel: "RSVP",
        ctaUrl: "https://example.com/x",
      })
      .expect(201);
    const page = messagePageDetailSchema.parse(created.body);
    const slug = page.primarySlug!;

    // Walk one card all the way through the funnel: viewed → clicked → replied.
    await request(app.getHttpServer()).get(`/messages/${slug}`).expect(200);
    await request(app.getHttpServer()).get(`/messages/${slug}/cta`).expect(302);
    await request(app.getHttpServer())
      .post(`/messages/${slug}/replies`)
      .send({ body: "Coming!" })
      .expect(202);

    const pageInsights = await request(app.getHttpServer())
      .get(`/message-pages/${page.id}/insights`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const insights = messagePageInsightsSchema.parse(pageInsights.body);
    expect(insights.funnel).toMatchObject({
      sent: 1,
      viewed: 1,
      clicked: 1,
      replied: 1,
      totalViews: 1,
      totalClicks: 1,
      totalReplies: 1,
    });
    expect(insights.firstViewedAt).not.toBeNull();

    // A second open of the same card must raise the raw event total (totalViews)
    // without inflating the distinct-cards stage (viewed) — the aggregate funnel
    // has to keep those two apart. See docs/adr/0136-message-page-analytics.md.
    await request(app.getHttpServer()).get(`/messages/${slug}`).expect(200);
    const reopened = messagePageInsightsSchema.parse(
      (
        await request(app.getHttpServer())
          .get(`/message-pages/${page.id}/insights`)
          .set("Authorization", `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    expect(reopened.funnel).toMatchObject({ sent: 1, viewed: 1, totalViews: 2 });

    // The account rollup sees the same journey and lists the page as a top page.
    const accountInsights = await request(app.getHttpServer())
      .get("/message-pages/insights")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const account = messagePageAccountInsightsSchema.parse(accountInsights.body);
    expect(account.pageCount).toBeGreaterThanOrEqual(1);
    expect(account.funnel).toMatchObject({ viewed: 1, clicked: 1, replied: 1 });
    expect(account.topPages.some((p) => p.id === page.id)).toBe(true);

    // Another account can't read this page's insights.
    const other = await signUp();
    await request(app.getHttpServer())
      .get(`/message-pages/${page.id}/insights`)
      .set("Authorization", `Bearer ${other.token}`)
      .expect(404);
  });

  it("records an append-only engagement event per view, click and reply (ADR 0136)", async () => {
    const { token, accountId } = await signUp();
    const created = await request(app.getHttpServer())
      .post("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Track me",
        allowReplies: true,
        ctaLabel: "Go",
        ctaUrl: "https://example.com/y",
      })
      .expect(201);
    const page = messagePageDetailSchema.parse(created.body);
    const slug = page.primarySlug!;

    await request(app.getHttpServer()).get(`/messages/${slug}`).expect(200);
    await request(app.getHttpServer()).get(`/messages/${slug}/cta`).expect(302);
    await request(app.getHttpServer())
      .post(`/messages/${slug}/replies`)
      .send({ body: "Hi" })
      .expect(202);

    const events = await prisma.messagePageEvent.findMany({
      where: { messagePageId: page.id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((event) => event.type)).toEqual(["viewed", "cta_clicked", "replied"]);
    // accountId/messagePageId are denormalised onto every row (no join needed).
    expect(events.every((event) => event.accountId === accountId)).toBe(true);
    expect(events.every((event) => event.messagePageId === page.id)).toBe(true);

    // An archived page's view is not counted, and so emits no event either.
    await request(app.getHttpServer())
      .delete(`/message-pages/${page.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);
    await request(app.getHttpServer()).get(`/messages/${slug}`).expect(200);
    const afterArchive = await prisma.messagePageEvent.count({ where: { messagePageId: page.id } });
    expect(afterArchive).toBe(3);
  });

  it("prunes engagement events past the retention window, keeping recent ones (ADR 0136)", async () => {
    const { token, accountId } = await signUp();
    const created = await request(app.getHttpServer())
      .post("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Old data" })
      .expect(201);
    const page = messagePageDetailSchema.parse(created.body);
    const link = await prisma.messagePageLink.findFirstOrThrow({
      where: { messagePageId: page.id },
    });
    const base = { messagePageLinkId: link.id, messagePageId: page.id, accountId } as const;

    // One event well past the 90-day default window, one from yesterday.
    await prisma.messagePageEvent.create({
      data: {
        ...base,
        type: "viewed",
        createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
      },
    });
    const recent = await prisma.messagePageEvent.create({
      data: { ...base, type: "viewed", createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    const result = await app.get(MessagePageEventsRetentionService).prune();
    expect(result.deleted).toBeGreaterThanOrEqual(1);

    const remaining = await prisma.messagePageEvent.findMany({ where: { messagePageId: page.id } });
    expect(remaining.map((event) => event.id)).toEqual([recent.id]);
  });

  it("returns a dense daily engagement time-series from the event log (ADR 0136)", async () => {
    const { token, accountId } = await signUp();
    const created = await request(app.getHttpServer())
      .post("/message-pages")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "Trends" })
      .expect(201);
    const page = messagePageDetailSchema.parse(created.body);
    const link = await prisma.messagePageLink.findFirstOrThrow({
      where: { messagePageId: page.id },
    });
    const base = { messagePageLinkId: link.id, messagePageId: page.id, accountId } as const;
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const today = new Date();
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    await prisma.messagePageEvent.createMany({
      data: [
        { ...base, type: "viewed", createdAt: today },
        { ...base, type: "viewed", createdAt: today },
        { ...base, type: "cta_clicked", createdAt: today },
        { ...base, type: "viewed", createdAt: twoDaysAgo },
      ],
    });

    const series = messagePageTimeSeriesSchema.parse(
      (
        await request(app.getHttpServer())
          .get(`/message-pages/${page.id}/insights/timeseries?days=30`)
          .set("Authorization", `Bearer ${token}`)
          .expect(200)
      ).body,
    );

    // Dense: exactly one entry per day in the window, oldest first, last = today.
    expect(series.days).toBe(30);
    expect(series.points).toHaveLength(30);
    expect(series.points.at(-1)?.date).toBe(dayKey(today));
    const byDate = new Map(series.points.map((point) => [point.date, point]));
    expect(byDate.get(dayKey(today))).toMatchObject({ views: 2, clicks: 1, replies: 0 });
    expect(byDate.get(dayKey(twoDaysAgo))).toMatchObject({ views: 1, clicks: 0, replies: 0 });
    // A day with no activity is present and zero-filled.
    const yesterday = dayKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
    expect(byDate.get(yesterday)).toMatchObject({ views: 0, clicks: 0, replies: 0 });
  });

  it("clamps the time-series window and serves an account-wide series", async () => {
    const { token } = await signUp();
    // Over the max clamps to 365, then to the retention window (default 90) so we
    // never present pruned days as "no activity"; a non-numeric value falls back
    // to the default 30. See docs/adr/0136-message-page-analytics.md.
    const capped = messagePageTimeSeriesSchema.parse(
      (
        await request(app.getHttpServer())
          .get("/message-pages/insights/timeseries?days=9999")
          .set("Authorization", `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    expect(capped.points).toHaveLength(90);

    const defaulted = messagePageTimeSeriesSchema.parse(
      (
        await request(app.getHttpServer())
          .get("/message-pages/insights/timeseries?days=notanumber")
          .set("Authorization", `Bearer ${token}`)
          .expect(200)
      ).body,
    );
    expect(defaulted.points).toHaveLength(30);
  });
});
