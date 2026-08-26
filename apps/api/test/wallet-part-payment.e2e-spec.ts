import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { App } from "supertest/types";
import Stripe from "stripe";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { STRIPE_CLIENT } from "../src/billing/stripe-client.provider";
import { BatchOrdersService } from "../src/batch-orders/batch-orders.service";
import type { EnvConfig } from "../src/config/env.schema";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/**
 * The wallet is always spent before the card (ADR 0169). The money questions
 * are: is Stripe charged the right remainder, can two checkouts overdraw one
 * balance, and does an abandoned checkout give the reservation back.
 *
 * The last one matters most. The wallet is debited when the Checkout Session is
 * created, so every path where the payment never completes has to hand it back —
 * miss one and a customer quietly loses their balance to an order that was never
 * printed.
 */
describe("Wallet part-payment (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let checkoutSessionsCreate: jest.Mock;
  let refundsCreate: jest.Mock;
  let signWebhook: (payload: string) => string;

  beforeAll(async () => {
    checkoutSessionsCreate = jest.fn();
    refundsCreate = jest.fn();
    // Session creation and refunds are mocked (they are network calls). Signature
    // verification is not: `webhooks` is the real SDK's, which is pure local
    // crypto, so a webhook test here still has to present a genuine signature.
    const realStripe = new Stripe("sk_test_placeholder_for_signature_verification");
    const mockStripe = {
      checkout: { sessions: { create: checkoutSessionsCreate } },
      refunds: { create: refundsCreate },
      webhooks: realStripe.webhooks,
    } as unknown as Stripe;
    app = await createTestApp([{ provide: STRIPE_CLIENT, useValue: mockStripe }]);
    prisma = app.get(PrismaService);
    const secret = app
      .get(ConfigService<EnvConfig, true>)
      .get("STRIPE_WEBHOOK_SECRET", { infer: true });
    signWebhook = (payload) => realStripe.webhooks.generateTestHeaderString({ payload, secret });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    checkoutSessionsCreate.mockReset();
    refundsCreate.mockReset();
    refundsCreate.mockImplementation(() =>
      Promise.resolve({ id: `re_test_${randomUUID()}`, status: "succeeded" }),
    );
    checkoutSessionsCreate.mockImplementation(() => {
      const id = randomUUID();
      return Promise.resolve({
        id: `cs_test_${id}`,
        url: `https://checkout.stripe.test/pay/cs_test_${id}`,
        payment_intent: `pi_test_${id}`,
      });
    });
  });

  async function signUp(): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID());
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Wallet Centre ${randomUUID()}` })
      .expect(201);
    return { token, accountId: (response.body as { id: string }).id };
  }

  async function credit(accountId: string, amountMinor: number): Promise<void> {
    const { _sum } = await prisma.walletLedgerEntry.aggregate({
      where: { accountId },
      _sum: { amountMinor: true },
    });
    const balance = _sum.amountMinor ?? 0;
    await prisma.walletLedgerEntry.create({
      data: {
        accountId,
        type: "adjustment",
        amountMinor,
        balanceAfterMinor: balance + amountMinor,
        reference: `seed:${randomUUID()}`,
      },
    });
  }

  async function balanceOf(accountId: string): Promise<number> {
    const { _sum } = await prisma.walletLedgerEntry.aggregate({
      where: { accountId },
      _sum: { amountMinor: true },
    });
    return _sum.amountMinor ?? 0;
  }

  /** A draft order for one 2nd-class card: £2.50 + £0.91 stamp = £3.41. */
  async function draftOrder(token: string): Promise<{ id: string; totalMinor: number }> {
    const design = await request(app.getHttpServer())
      .get("/card-designs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const cardDesignId = (design.body as { id: string }[])[0]!.id;
    const saved = await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({ cardDesignId, name: "Wallet test" })
      .expect(201);
    const savedDesignId = (saved.body as { id: string }).id;

    const order = await request(app.getHttpServer())
      .post("/batch-orders/quick-send")
      .set("Authorization", `Bearer ${token}`)
      .send({
        savedDesignId,
        firstName: "Sam",
        lastName: "Trent",
        shippingAddressLine1: "1 High Street",
        shippingAddressCity: "London",
        shippingAddressPostcode: "SW1A 1AA",
        postageClass: "second_class",
      })
      .expect(201);
    const body = order.body as { id: string; totalMinor: number };
    return { id: body.id, totalMinor: body.totalMinor };
  }

  function checkout(token: string, orderId: string) {
    return request(app.getHttpServer())
      .post(`/batch-orders/${orderId}/checkout`)
      .set("Authorization", `Bearer ${token}`);
  }

  /** What Stripe was asked to charge on the most recent session. */
  function lastChargedMinor(): number {
    const calls = checkoutSessionsCreate.mock.calls as {
      line_items: { price_data: { unit_amount: number } }[];
    }[][];
    const call = calls.at(-1)?.[0];
    if (!call) throw new Error("Stripe was never asked to create a session");
    return call.line_items[0]!.price_data.unit_amount;
  }

  it("charges the card only what the wallet doesn't cover", async () => {
    const { token, accountId } = await signUp();
    await credit(accountId, 100); // £1 goodwill
    const order = await draftOrder(token);

    await checkout(token, order.id).expect(201);

    expect(lastChargedMinor()).toBe(order.totalMinor - 100);
    expect(await balanceOf(accountId)).toBe(0);
    const row = await prisma.batchOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.walletAppliedMinor).toBe(100);
  });

  it("skips Stripe entirely when the wallet covers the whole order", async () => {
    const { token, accountId } = await signUp();
    await credit(accountId, 5_000);
    const order = await draftOrder(token);

    const response = await checkout(token, order.id).expect(201);

    expect(checkoutSessionsCreate).not.toHaveBeenCalled();
    // Every caller redirects to whatever this returns, so a fully wallet-paid
    // order goes straight to the success page.
    expect((response.body as { checkoutUrl: string }).checkoutUrl).toContain(
      "/batch-orders/success",
    );
    const row = await prisma.batchOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe("paid");
    expect(row.paymentMethod).toBe("wallet");
    expect(await balanceOf(accountId)).toBe(5_000 - order.totalMinor);
    // Paid means printable: the cards are in the fulfilment queue.
    expect(
      await prisma.fulfillmentJob.count({ where: { orderRecipient: { batchOrderId: order.id } } }),
    ).toBe(1);
  });

  it("leaves Stripe a chargeable amount when the balance nearly covers the order", async () => {
    const { token, accountId } = await signUp();
    const order = await draftOrder(token);
    await credit(accountId, order.totalMinor - 10); // 10p short

    await checkout(token, order.id).expect(201);

    // 10p is under Stripe's 30p floor, so the wallet draw is trimmed.
    expect(lastChargedMinor()).toBe(30);
    expect(await balanceOf(accountId)).toBe(20);
  });

  it("never lets two concurrent checkouts spend the same balance twice", async () => {
    const { token, accountId } = await signUp();
    await credit(accountId, 100);
    // Set up sequentially. Only the two checkouts below are meant to race; each
    // draftOrder is three HTTP round trips, and running those in parallel too
    // adds a socket race to the fixture that has nothing to do with the wallet.
    const a = await draftOrder(token);
    const b = await draftOrder(token);

    // Driven at the service, not over HTTP. What is being tested is a database
    // transaction racing itself; supertest binds a fresh ephemeral port per
    // request, so firing two through it in parallel adds a socket race that has
    // nothing to do with the wallet and fails on a loaded runner with
    // ECONNRESET. This calls the same method the controller calls.
    const service = app.get(BatchOrdersService);
    const settled = await Promise.allSettled([
      service.checkout(accountId, null, a.id),
      service.checkout(accountId, null, b.id),
    ]);

    // Losing the race is a legitimate outcome under contention — Postgres
    // aborts one transaction and, once the retries are spent, the caller gets a
    // 503 telling it to try again. What must never happen is both succeeding
    // against the same money.
    const applied = (
      await prisma.batchOrder.findMany({
        where: { id: { in: [a.id, b.id] } },
        select: { walletAppliedMinor: true },
      })
    ).reduce((sum, r) => sum + r.walletAppliedMinor, 0);
    const balance = await balanceOf(accountId);

    // Conservation is the real invariant, and it holds however the race landed:
    // every penny is either still in the wallet or reserved against exactly one
    // order. Without Serializable isolation this reads 200 applied and a balance
    // of −100.
    expect(applied + balance).toBe(100);
    expect(applied).toBeLessThanOrEqual(100);
    expect(balance).toBeGreaterThanOrEqual(0);
    // At least one had to get through; both failing would mean nothing works.
    expect(settled.some((r) => r.status === "fulfilled")).toBe(true);
  });

  it("gives the reservation back when Stripe won't create a session", async () => {
    const { token, accountId } = await signUp();
    await credit(accountId, 100);
    const order = await draftOrder(token);
    checkoutSessionsCreate.mockRejectedValueOnce(new Error("Stripe is down"));

    await checkout(token, order.id).expect(500);

    // The order is payable again and the customer still has their £1.
    const row = await prisma.batchOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe("draft");
    expect(row.walletAppliedMinor).toBe(0);
    expect(await balanceOf(accountId)).toBe(100);
  });

  it("gives the reservation back when the buyer cancels an unpaid order", async () => {
    const { token, accountId } = await signUp();
    await credit(accountId, 100);
    const order = await draftOrder(token);
    await checkout(token, order.id).expect(201);
    expect(await balanceOf(accountId)).toBe(0);

    await request(app.getHttpServer())
      .post(`/batch-orders/${order.id}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(await balanceOf(accountId)).toBe(100);
    const row = await prisma.batchOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.walletAppliedMinor).toBe(0);
  });

  it("reserves once across a resumed checkout, not twice", async () => {
    const { token, accountId } = await signUp();
    await credit(accountId, 100);
    const order = await draftOrder(token);

    await checkout(token, order.id).expect(201);
    // The buyer closed Stripe and came back.
    await checkout(token, order.id).send({ resume: true }).expect(201);

    // Same reservation re-used, so the second session charges the same
    // remainder and the £1 has left the wallet exactly once.
    expect(lastChargedMinor()).toBe(order.totalMinor - 100);
    expect(await balanceOf(accountId)).toBe(0);
    const charges = await prisma.walletLedgerEntry.count({
      where: { accountId, reference: `order:${order.id}:wallet` },
    });
    expect(charges).toBe(1);
  });

  it("returns both halves when a split order is refunded", async () => {
    const { token, accountId } = await signUp();
    await credit(accountId, 100);
    const order = await draftOrder(token);
    await checkout(token, order.id).expect(201);

    // Settle it as the payment webhook would.
    await prisma.batchOrder.update({
      where: { id: order.id },
      data: { status: "paid", paymentMethod: "card" },
    });

    await request(app.getHttpServer())
      .post(`/batch-orders/${order.id}/cancel-refund`)
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    // Stripe refunds its leg…
    expect(refundsCreate).toHaveBeenCalledTimes(1);
    // …and the wallet leg comes back to the wallet, not to the card.
    expect(await balanceOf(accountId)).toBe(100);
  });

  it("reports the split on the order, for the customer and for ops", async () => {
    const { token, accountId } = await signUp();
    await credit(accountId, 100);
    const order = await draftOrder(token);
    await checkout(token, order.id).expect(201);

    // The customer's own order view. Without this the page can only say "Card",
    // and the £1 that came off their balance is invisible.
    const mine = await request(app.getHttpServer())
      .get(`/batch-orders/${order.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect((mine.body as { walletAppliedMinor: number }).walletAppliedMinor).toBe(100);

    // And the ops Customer 360 order detail, so a support query about a receipt
    // that disagrees with the order total can be answered from that screen.
    const opsUserId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId: opsUserId, role: "super_admin" } });
    const opsView = await request(app.getHttpServer())
      .get(`/admin/orders/${order.id}`)
      .set("Authorization", `Bearer ${await mintToken(opsUserId)}`)
      .expect(200);
    expect((opsView.body as { walletAppliedMinor: number }).walletAppliedMinor).toBe(100);
  });

  it("refuses to hand back the wallet portion of an order that is already paid", async () => {
    const { token, accountId } = await signUp();
    await credit(accountId, 100);
    const order = await draftOrder(token);
    await checkout(token, order.id).expect(201);
    // Settle it, as the payment webhook would.
    await prisma.batchOrder.update({
      where: { id: order.id },
      data: { status: "paid", paymentMethod: "card" },
    });

    // Cancelling a paid order is refused — but the refusal must come *before*
    // anything touches the money. Releasing first and checking after would
    // credit a customer for a card that is already going to print, and destroy
    // the order's record of its wallet portion so a later refund pays the
    // wallet leg a second time.
    await request(app.getHttpServer())
      .post(`/batch-orders/${order.id}/cancel`)
      .set("Authorization", `Bearer ${token}`)
      .expect(409);

    expect(await balanceOf(accountId)).toBe(0);
    const row = await prisma.batchOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.walletAppliedMinor).toBe(100);
    expect(row.status).toBe("paid");
  });

  it("gives the reservation back when a delayed payment method later fails", async () => {
    const { token, accountId } = await signUp();
    await credit(accountId, 100);
    const order = await draftOrder(token);
    await checkout(token, order.id).expect(201);
    expect(await balanceOf(accountId)).toBe(0);

    // A bank-debit style method completes checkout unpaid and settles later.
    // When it settles *failed*, the order goes back to draft — and the money
    // held against it has to come back too.
    const session = (await checkoutSessionsCreate.mock.results.at(-1)?.value) as { id: string };
    const payload = JSON.stringify({
      id: `evt_${randomUUID()}`,
      object: "event",
      api_version: "2025-01-01",
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      pending_webhooks: 0,
      request: null,
      type: "checkout.session.async_payment_failed",
      data: { object: { id: session.id, metadata: { batchOrderId: order.id } } },
    });
    await request(app.getHttpServer())
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signWebhook(payload))
      .send(payload)
      .expect(201);

    expect(await balanceOf(accountId)).toBe(100);
    const row = await prisma.batchOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe("draft");
    expect(row.walletAppliedMinor).toBe(0);
  });

  it("tells Kudos HQ about an order paid entirely from the wallet", async () => {
    const { token, accountId } = await signUp();
    await credit(accountId, 5_000);
    const order = await draftOrder(token);

    await checkout(token, order.id).expect(201);

    // Every other payment route raises this. An order settled from a balance is
    // still an order HQ needs to know about — it is going to print.
    const notified = await prisma.platformNotification.count({
      where: { kind: "new_order", entityId: order.id },
    });
    expect(notified).toBeGreaterThan(0);
  });

  it("is unchanged for an account with no balance", async () => {
    const { token, accountId } = await signUp();
    const order = await draftOrder(token);

    await checkout(token, order.id).expect(201);

    expect(lastChargedMinor()).toBe(order.totalMinor);
    expect(await balanceOf(accountId)).toBe(0);
    expect(await prisma.walletLedgerEntry.count({ where: { accountId } })).toBe(0);
  });
});
