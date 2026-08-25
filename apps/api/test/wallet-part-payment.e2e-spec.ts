import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import type { App } from "supertest/types";
import type Stripe from "stripe";
import request from "supertest";
import { PrismaService } from "../src/prisma/prisma.service";
import { STRIPE_CLIENT } from "../src/billing/stripe-client.provider";
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

  beforeAll(async () => {
    checkoutSessionsCreate = jest.fn();
    refundsCreate = jest.fn();
    const mockStripe = {
      checkout: { sessions: { create: checkoutSessionsCreate } },
      refunds: { create: refundsCreate },
    } as unknown as Stripe;
    app = await createTestApp([{ provide: STRIPE_CLIENT, useValue: mockStripe }]);
    prisma = app.get(PrismaService);
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
    const [a, b] = await Promise.all([draftOrder(token), draftOrder(token)]);

    const results = await Promise.all([checkout(token, a.id).send(), checkout(token, b.id).send()]);
    expect(results.every((r) => r.status === 201)).toBe(true);

    // Whatever order they landed in, the £1 can only have been spent once.
    const rows = await prisma.batchOrder.findMany({
      where: { id: { in: [a.id, b.id] } },
      select: { walletAppliedMinor: true },
    });
    const applied = rows.reduce((sum, r) => sum + r.walletAppliedMinor, 0);
    expect(applied).toBe(100);
    // And the ledger agrees — a balance can never go negative.
    expect(await balanceOf(accountId)).toBe(0);
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

  it("is unchanged for an account with no balance", async () => {
    const { token, accountId } = await signUp();
    const order = await draftOrder(token);

    await checkout(token, order.id).expect(201);

    expect(lastChargedMinor()).toBe(order.totalMinor);
    expect(await balanceOf(accountId)).toBe(0);
    expect(await prisma.walletLedgerEntry.count({ where: { accountId } })).toBe(0);
  });
});
