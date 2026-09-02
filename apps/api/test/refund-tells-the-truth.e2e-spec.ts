import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import request from "supertest";
import type Stripe from "stripe";
import { PrismaService } from "../src/prisma/prisma.service";
import { STRIPE_CLIENT } from "../src/billing/stripe-client.provider";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * What a refund says happened, versus what happened.
 *
 * ADR 0180's rule is that a refunded order with cards in production must never
 * be silent. Two paths broke it in the same direction — not by failing loudly,
 * but by recording success:
 *
 *   - Click & Drop switched off returned an empty `failed` list for identifiers
 *     it had not cancelled, so the escalation never fired and the audit row
 *     asserted nothing was left live.
 *   - `raced` was built from the pre-delete snapshot, so a card that reached
 *     `posted` after the read and before the delete was excluded from the very
 *     report it should have led.
 *
 * Both end the same way: customer refunded, card posted and on its way, order
 * `cancelled`, and an audit trail saying otherwise. That is worse than the bug
 * ADR 0180 replaced, because the trail now actively misleads.
 */
describe("A refund tells the truth about what it could not stop (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let refundsCreate: jest.Mock;

  beforeAll(async () => {
    refundsCreate = jest.fn(() =>
      Promise.resolve({ id: `re_test_${randomUUID()}`, status: "succeeded" }),
    );
    const stripe = { refunds: { create: refundsCreate } } as unknown as Stripe;
    app = await createTestApp([{ provide: STRIPE_CLIENT, useValue: stripe }]);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function signUp(): Promise<string> {
    const token = await mintToken(randomUUID());
    await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Refund co ${randomUUID()}` })
      .expect(201);
    return token;
  }

  async function superAdmin(): Promise<string> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId, role: "super_admin" } });
    return userId;
  }

  /** A paid order with one pending fulfilment job, built directly: this suite is
   * about the release path, not about checkout. */
  async function paidOrder(
    token: string,
    { imported = false }: { imported?: boolean } = {},
  ): Promise<{ orderId: string; jobId: string }> {
    const me = await request(app.getHttpServer())
      .get("/accounts/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const accountId = (me.body as { id: string }).id;

    const recipient = await prisma.recipient.create({
      data: {
        accountId,
        firstName: "Ada",
        lastName: `Buyer ${randomUUID().slice(0, 8)}`,
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
      },
    });
    const order = await prisma.batchOrder.create({
      data: {
        accountId,
        status: "paid",
        paymentMethod: "card",
        stripePaymentIntentId: `pi_test_${randomUUID()}`,
        subtotalMinor: 500,
        postageMinor: 100,
        totalMinor: 720,
      },
    });
    const templates = await request(app.getHttpServer())
      .get("/card-designs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const saved = await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({
        cardDesignId: (templates.body as { id: string }[])[0]!.id,
        name: `Design ${randomUUID().slice(0, 8)}`,
      })
      .expect(201);

    const line = await prisma.orderRecipient.create({
      data: {
        batchOrderId: order.id,
        recipientId: recipient.id,
        savedDesignId: (saved.body as { id: string }).id,
        status: "queued",
        dispatchOption: "asap",
        postageClass: "second_class",
        priceMinor: 500,
        postageMinor: 100,
        shippingAddressLine1: "1 Test Street",
        shippingAddressCity: "London",
        shippingAddressPostcode: "SW1A 1AA",
        shippingAddressCountry: "GB",
      },
    });
    const job = await prisma.fulfillmentJob.create({
      data: {
        orderRecipientId: line.id,
        status: "pending",
        ...(imported ? { clickAndDropOrderId: `cd-${randomUUID().slice(0, 8)}` } : {}),
      },
    });
    return { orderId: order.id, jobId: job.id };
  }

  const refund = (token: string, orderId: string) =>
    request(app.getHttpServer())
      .post(`/batch-orders/${orderId}/cancel-refund`)
      .set("Authorization", `Bearer ${token}`);

  const auditFor = (orderId: string) =>
    prisma.auditLogEntry.findFirstOrThrow({
      where: { targetType: "BatchOrder", targetId: orderId, action: "cancel_refund" },
    });

  it("escalates cards it could not recall because Click & Drop is switched off", async () => {
    // The e2e app runs the no-op client, which is the disabled branch: it
    // returned `failed: []` for identifiers it had not touched, so nothing
    // escalated and the audit row said nothing was left live.
    const operator = await superAdmin();
    const token = await signUp();
    const { orderId } = await paidOrder(token, { imported: true });

    await refund(token, orderId).expect(201);

    const alert = await prisma.platformNotification.findFirst({
      where: { kind: "click_and_drop_cancel_failed", userId: operator },
    });
    expect(alert).not.toBeNull();

    const audit = await auditFor(orderId);
    const metadata = audit.metadata as { clickAndDropStillLive: string[] };
    // The card is still in Royal Mail's queue, so the record must say so.
    expect(metadata.clickAndDropStillLive).toHaveLength(1);
  });

  it("reports a card that reached posted between the read and the delete", async () => {
    // The window `raced` is meant to cover, and the one it missed: `stopped`
    // used the fresh re-read while membership used the stale snapshot, so a job
    // that was `pending` at the read and `posted` by the delete fell out of the
    // report entirely.
    const operator = await superAdmin();
    const token = await signUp();
    const { orderId, jobId } = await paidOrder(token);

    let raceOnce: (() => Promise<void>) | null = async () => {
      raceOnce = null;
      await prisma.fulfillmentJob.update({
        where: { id: jobId },
        data: { status: "posted", postedAt: new Date() },
      });
    };
    const middleware: Parameters<typeof prisma.$use>[0] = async (params, next) => {
      const result: unknown = await next(params);
      if (params.model === "FulfillmentJob" && params.action === "findMany" && raceOnce) {
        // Committed on its own connection, so the delete's fresh snapshot sees
        // it — which is what makes this a race rather than a stubbed status.
        await raceOnce();
      }
      return result;
    };
    prisma.$use(middleware);

    await refund(token, orderId).expect(201);

    const job = await prisma.fulfillmentJob.findUnique({ where: { id: jobId } });
    expect(job).not.toBeNull();
    expect(job!.status).toBe("posted");

    const alert = await prisma.platformNotification.findFirst({
      where: { kind: "refund_raced_fulfillment", userId: operator },
    });
    expect(alert).not.toBeNull();

    const audit = await auditFor(orderId);
    const metadata = audit.metadata as { racedCards: { jobId: string; stopped: boolean }[] };
    expect(metadata.racedCards).toHaveLength(1);
    expect(metadata.racedCards[0]!.jobId).toBe(jobId);
    expect(metadata.racedCards[0]!.stopped).toBe(false);
  });

  it("reports a card that was already in production, and stopped it", async () => {
    // The other half of `raced`: a job past `pending` when the release read it
    // is deleted by the release — stopped, but it was still in production when
    // the money came back, and ADR 0180 says somebody is told either way.
    // It cannot simply start `printed`: the pre-Stripe guard refuses to refund
    // an order whose cards have already left `pending` (409), so this state is
    // only reachable by the same race — the status moves after the guard has
    // passed and before the delete.
    const operator = await superAdmin();
    const token = await signUp();
    const { orderId, jobId } = await paidOrder(token);

    let raceOnce: (() => Promise<void>) | null = async () => {
      raceOnce = null;
      await prisma.fulfillmentJob.update({
        where: { id: jobId },
        data: { status: "printed" },
      });
    };
    prisma.$use(async (params, next) => {
      const result: unknown = await next(params);
      if (params.model === "FulfillmentJob" && params.action === "findMany" && raceOnce) {
        await raceOnce();
      }
      return result;
    });

    await refund(token, orderId).expect(201);

    expect(await prisma.fulfillmentJob.findUnique({ where: { id: jobId } })).toBeNull();
    const alert = await prisma.platformNotification.findFirst({
      where: { kind: "refund_raced_fulfillment", userId: operator },
    });
    expect(alert).not.toBeNull();

    const audit = await auditFor(orderId);
    const metadata = audit.metadata as {
      racedCards: { jobId: string; status: string; stopped: boolean }[];
    };
    expect(metadata.racedCards).toHaveLength(1);
    expect(metadata.racedCards[0]).toMatchObject({ jobId, status: "printed", stopped: true });
  });

  it("still records a clean refund as clean", async () => {
    // The guard must not turn every refund into an escalation.
    const token = await signUp();
    const { orderId, jobId } = await paidOrder(token);

    await refund(token, orderId).expect(201);

    expect(await prisma.fulfillmentJob.findUnique({ where: { id: jobId } })).toBeNull();
    const audit = await auditFor(orderId);
    const metadata = audit.metadata as {
      clickAndDropStillLive: string[];
      racedCards: unknown[];
    };
    expect(metadata.clickAndDropStillLive).toEqual([]);
    expect(metadata.racedCards).toEqual([]);
  });

  afterEach(() => refundsCreate.mockClear());
});
