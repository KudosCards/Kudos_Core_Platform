import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { CLEARED_BY_DELIVERY } from "../src/email-suppression/email-suppression.service";
import { createTestApp } from "./util/create-test-app";

// The endpoint refuses everything without a secret, and CI has no .env.
const SECRET = "brevo-webhook-test-secret";
process.env.BREVO_WEBHOOK_SECRET = SECRET;

/** Seconds since the epoch, which is what Brevo's `ts_event` carries. */
const at = (iso: string): number => Math.floor(new Date(iso).getTime() / 1000);

describe("POST /webhooks/brevo (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.emailSuppression.deleteMany();
  });

  const post = (body: object | object[], secret: string | null = SECRET) => {
    const req = request(app.getHttpServer()).post("/webhooks/brevo");
    return secret === null ? req.send(body) : req.set("x-brevo-webhook-secret", secret).send(body);
  };

  const bounce = (overrides: Record<string, unknown> = {}) => ({
    event: "hard_bounce",
    email: "gone@example.com",
    reason: "unknown user",
    subject: "Reset your password",
    "message-id": "<202609.1@relay.brevo.com>",
    ts_event: at("2026-09-18T09:00:00Z"),
    ...overrides,
  });

  it("records the address Brevo refused, with Brevo's own wording", async () => {
    await post(bounce()).expect(200, { received: true });

    const row = await prisma.emailSuppression.findUnique({ where: { email: "gone@example.com" } });
    expect(row).toMatchObject({
      reason: "hard_bounce",
      detail: "unknown user",
      subject: "Reset your password",
      messageId: "<202609.1@relay.brevo.com>",
      occurredAt: new Date("2026-09-18T09:00:00Z"),
      clearedAt: null,
    });
  });

  // Brevo matches addresses case-insensitively. Storing the address as sent
  // would leave `Gone@Example.com` looking deliverable while Brevo blocks it.
  it("stores the address lowercased so a later lookup cannot miss it", async () => {
    await post(bounce({ email: "  Gone@Example.COM " })).expect(200);

    expect(
      await prisma.emailSuppression.findUnique({ where: { email: "gone@example.com" } }),
    ).not.toBeNull();
  });

  it("falls back to Brevo's `ts` when the payload carries no `ts_event`", async () => {
    await post(bounce({ ts_event: undefined, ts: at("2026-09-18T09:00:00Z") })).expect(200);

    const row = await prisma.emailSuppression.findUnique({ where: { email: "gone@example.com" } });
    expect(row?.occurredAt).toEqual(new Date("2026-09-18T09:00:00Z"));
  });

  // Brevo's docs call its epoch fields seconds in one place and milliseconds in
  // another. Reading milliseconds as seconds would date the event to 1970 and
  // quietly disable the ordering guard below.
  it("reads a millisecond timestamp as well as a second one", async () => {
    await post(bounce({ ts_event: new Date("2026-09-18T09:00:00Z").getTime() })).expect(200);

    const row = await prisma.emailSuppression.findUnique({ where: { email: "gone@example.com" } });
    expect(row?.occurredAt).toEqual(new Date("2026-09-18T09:00:00Z"));
  });

  it("refuses a request with the wrong secret, and records nothing", async () => {
    await post(bounce(), "not-the-secret").expect(401);
    await post(bounce(), null).expect(401);

    expect(await prisma.emailSuppression.count()).toBe(0);
  });

  // Brevo's dashboard has not always allowed custom headers on a webhook, so
  // the secret is accepted in the URL as well.
  it("accepts the secret in the query string", async () => {
    await request(app.getHttpServer())
      .post(`/webhooks/brevo?secret=${SECRET}`)
      .send(bounce())
      .expect(200);

    expect(await prisma.emailSuppression.count()).toBe(1);
  });

  // The global ValidationPipe runs with forbidNonWhitelisted. A DTO class here
  // would 400 on Brevo's own payload the moment they added a field, silently
  // switching the whole feature off.
  it("accepts fields it has never seen rather than rejecting the payload", async () => {
    await post(
      bounce({ "X-Mailin-custom": "anything", sending_ip: "1.2.3.4", tags: ["transac"] }),
    ).expect(200);

    expect(await prisma.emailSuppression.count()).toBe(1);
  });

  it("records nothing for a soft bounce, which is a full mailbox rather than a dead one", async () => {
    await post(bounce({ event: "soft_bounce", reason: "mailbox full" })).expect(200, {
      received: true,
    });

    expect(await prisma.emailSuppression.count()).toBe(0);
  });

  it("takes a later delivery as proof from Brevo that the address works again", async () => {
    await post(bounce()).expect(200);
    await post({
      event: "delivered",
      email: "gone@example.com",
      ts_event: at("2026-09-20T09:00:00Z"),
    }).expect(200);

    const row = await prisma.emailSuppression.findUnique({ where: { email: "gone@example.com" } });
    expect(row?.clearedAt).not.toBeNull();
    expect(row?.clearedBy).toBe(CLEARED_BY_DELIVERY);
  });

  // Webhooks arrive out of order. A delivery from before the bounce says
  // nothing about now, and acting on it would declare a dead address healthy —
  // straight back to the silent failure this endpoint exists to end.
  it("ignores a delivery older than the event that suppressed the address", async () => {
    await post(bounce()).expect(200);
    await post({
      event: "delivered",
      email: "gone@example.com",
      ts_event: at("2026-09-17T09:00:00Z"),
    }).expect(200);

    const row = await prisma.emailSuppression.findUnique({ where: { email: "gone@example.com" } });
    expect(row?.clearedAt).toBeNull();
  });

  it("ignores a delivery with no timestamp, which cannot be placed in order", async () => {
    await post(bounce()).expect(200);
    await post({ event: "delivered", email: "gone@example.com" }).expect(200);

    const row = await prisma.emailSuppression.findUnique({ where: { email: "gone@example.com" } });
    expect(row?.clearedAt).toBeNull();
  });

  it("re-opens a cleared row when the address stops working again", async () => {
    await post(bounce()).expect(200);
    await post({
      event: "delivered",
      email: "gone@example.com",
      ts_event: at("2026-09-20T09:00:00Z"),
    }).expect(200);
    await post(
      bounce({ event: "spam", reason: "spam complaint", ts_event: at("2026-09-21T09:00:00Z") }),
    ).expect(200);

    const row = await prisma.emailSuppression.findUnique({ where: { email: "gone@example.com" } });
    expect(row).toMatchObject({
      reason: "spam",
      detail: "spam complaint",
      clearedAt: null,
      clearedBy: null,
    });
  });

  // Brevo has batched events in the past; one bad row must not cost us the rest.
  it("records every event in a batched payload", async () => {
    await post([
      bounce({ email: "one@example.com" }),
      bounce({ email: "two@example.com", event: "blocked" }),
    ]).expect(200);

    expect(await prisma.emailSuppression.count()).toBe(2);
  });

  it("swallows a payload it cannot read instead of asking Brevo to retry it", async () => {
    await post({ event: "hard_bounce" }).expect(200, { received: true });
    await post({ event: "hard_bounce", email: "not-an-address" }).expect(200, { received: true });

    expect(await prisma.emailSuppression.count()).toBe(0);
  });
});
