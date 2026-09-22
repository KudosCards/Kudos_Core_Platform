import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { accountSchema } from "@kudos/shared-types";
import type { App } from "supertest/types";
import request from "supertest";
import Stripe from "stripe";
import { PrismaService } from "../src/prisma/prisma.service";
import { STRIPE_CLIENT } from "../src/billing/stripe-client.provider";
import { EMAIL_CLIENT, type SendEmailInput } from "../src/email/email.client";
import type { WalletWatchResult } from "../src/wallet/wallet-watch.service";
import type { EnvConfig } from "../src/config/env.schema";
import { createTestApp } from "./util/create-test-app";
import { mintToken } from "./util/test-jwks";

/** Today as a plain YYYY-MM-DD — an occasion dated today has a dispatch date in
 * the past, so it is inside every horizon this suite uses. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A card + First-class postage on the Pro plan: £2.25 + £1.80. */
const CARD_TOTAL_MINOR = 225 + 180;

describe("Wallet watch (e2e)", () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let webhookSecret: string;
  const cryptoStripe = new Stripe("sk_test_wallet_watch_crypto_only");
  const sendTransactional = jest.fn<Promise<void>, [SendEmailInput]>();
  const paymentMethodsList = jest.fn();
  const customersRetrieve = jest.fn();
  const invoicesCreate = jest.fn();
  const invoiceItemsCreate = jest.fn();
  const invoicesFinalize = jest.fn();
  const invoicesPay = jest.fn();

  beforeAll(async () => {
    const mockStripe = {
      checkout: { sessions: { create: jest.fn() } },
      webhooks: cryptoStripe.webhooks,
      customers: { retrieve: customersRetrieve },
      paymentMethods: { list: paymentMethodsList },
      invoiceItems: { create: invoiceItemsCreate },
      invoices: {
        create: invoicesCreate,
        finalizeInvoice: invoicesFinalize,
        pay: invoicesPay,
        retrieve: jest.fn(),
      },
    } as unknown as Stripe;
    app = await createTestApp([
      { provide: STRIPE_CLIENT, useValue: mockStripe },
      { provide: EMAIL_CLIENT, useValue: { sendTransactional } },
    ]);
    prisma = app.get(PrismaService);
    const config = app.get(ConfigService<EnvConfig, true>);
    webhookSecret = config.get("STRIPE_WEBHOOK_SECRET", { infer: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // A healthy, unexpired card on file, and a customer with no stated default —
    // the common case. Individual tests override.
    const nextYear = new Date().getUTCFullYear() + 2;
    paymentMethodsList.mockResolvedValue({
      data: [{ id: "pm_good", card: { exp_month: 12, exp_year: nextYear } }],
    });
    customersRetrieve.mockResolvedValue({ id: "cus_test", invoice_settings: {} });
    invoicesCreate.mockImplementation(() => Promise.resolve({ id: `in_${randomUUID()}` }));
    invoiceItemsCreate.mockResolvedValue({ id: "ii_test" });
    invoicesFinalize.mockImplementation((id: string) => Promise.resolve({ id }));
    invoicesPay.mockImplementation((id: string) =>
      Promise.resolve({
        id,
        status: "paid",
        hosted_invoice_url: `https://stripe.test/i/${id}`,
        invoice_pdf: `https://stripe.test/i/${id}.pdf`,
      }),
    );
  });

  async function signUp(email: string): Promise<{ token: string; accountId: string }> {
    const token = await mintToken(randomUUID(), email);
    const response = await request(app.getHttpServer())
      .post("/accounts")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "organisation", name: `Centre ${randomUUID()}` })
      .expect(201);
    return { token, accountId: accountSchema.parse(response.body).id };
  }

  async function opsToken(): Promise<string> {
    const userId = randomUUID();
    await prisma.platformAdmin.create({ data: { userId } });
    return mintToken(userId);
  }

  function runWatch(bearer: string) {
    return request(app.getHttpServer())
      .post("/wallet-watch/run")
      .set("Authorization", `Bearer ${bearer}`);
  }

  async function creditWallet(accountId: string, amountMinor: number): Promise<void> {
    const sessionId = `cs_test_${randomUUID()}`;
    const payload = JSON.stringify({
      id: `evt_${randomUUID()}`,
      object: "event",
      type: "checkout.session.completed",
      data: {
        object: {
          id: sessionId,
          payment_status: "paid",
          metadata: { type: "wallet_topup", accountId, amountMinor: String(amountMinor) },
        },
      },
    });
    const signature = cryptoStripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    });
    await request(app.getHttpServer())
      .post("/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signature)
      .send(payload)
      .expect(201);
  }

  /** An account on Pro (so auto-send is permitted) with a Stripe customer. */
  async function proAccount(email: string): Promise<{ token: string; accountId: string }> {
    const account = await signUp(email);
    await prisma.account.update({
      where: { id: account.accountId },
      data: { planId: "pro", stripeCustomerId: `cus_${randomUUID()}` },
    });
    return account;
  }

  async function createRecipient(token: string, firstName: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post("/recipients")
      .set("Authorization", `Bearer ${token}`)
      .send({
        firstName,
        lastName: "Recipient",
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
      })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  async function createSavedDesign(token: string): Promise<string> {
    const templates = await request(app.getHttpServer())
      .get("/card-designs")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const cardDesignId = (templates.body as { id: string }[])[0]!.id;
    const response = await request(app.getHttpServer())
      .post("/saved-designs")
      .set("Authorization", `Bearer ${token}`)
      .send({ cardDesignId, name: "Watch design" })
      .expect(201);
    return (response.body as { id: string }).id;
  }

  /** An approved auto-send card, dated `daysAhead` from today. Left approved
   * (never run through auto-send) so it counts as committed spend. */
  async function commitCard(
    token: string,
    savedDesignId: string,
    recipientName: string,
    daysAhead: number,
  ): Promise<string> {
    const recipientId = await createRecipient(token, recipientName);
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + daysAhead);
    const created = await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        type: "achievement",
        occasionDate: daysAhead === 0 ? todayIso() : date.toISOString().slice(0, 10),
        recipientId,
      })
      .expect(201);
    const occasionId = (created.body as { id: string }).id;
    await request(app.getHttpServer())
      .post(`/occasions/${occasionId}/approve`)
      .set("Authorization", `Bearer ${token}`)
      .send({ savedDesignId, dispatchOption: "auto_send" })
      .expect(201);
    // Approval derives a dispatch date from the occasion date; pin it so the
    // ordering this suite asserts on is the ordering it set up.
    await prisma.occasion.update({
      where: { id: occasionId },
      data: { dispatchDate: date },
    });
    return occasionId;
  }

  async function notices(accountId: string, kind: string) {
    return prisma.notification.findMany({
      where: { accountId, kind },
      orderBy: { createdAt: "asc" },
    });
  }

  function mailTo(address: string): SendEmailInput[] {
    return sendTransactional.mock.calls
      .map(([input]) => input)
      .filter((input) => input.to === address);
  }

  async function enableAutoTopUp(
    token: string,
    body: { enabled: boolean; thresholdMinor: number; amountMinor: number },
  ) {
    return request(app.getHttpServer())
      .patch("/wallet/auto-top-up")
      .set("Authorization", `Bearer ${token}`)
      .send(body)
      .expect(200);
  }

  it("names the first card the balance will not reach", async () => {
    const email = `watch-warn-${randomUUID()}@example.com`;
    const { token, accountId } = await proAccount(email);
    const savedDesignId = await createSavedDesign(token);
    // Two cards at £4.05 each; fund only the first.
    await commitCard(token, savedDesignId, "Ada", 3);
    await commitCard(token, savedDesignId, "Grace", 10);
    await creditWallet(accountId, CARD_TOTAL_MINOR);

    await runWatch(await opsToken()).expect(201);

    const warned = await notices(accountId, "wallet_low_balance");
    expect(warned).toHaveLength(1);
    expect(warned[0]!.title).toBe("Your wallet will not cover Grace Recipient's card");
    expect(warned[0]!.body).toContain("covers the next 1 of 2 cards");
    expect(warned[0]!.href).toBe("/wallet");

    const mail = mailTo(email);
    expect(mail).toHaveLength(1);
    expect(mail[0]!.subject).toBe("Your Kudos wallet will not cover the next cards");
    expect(mail[0]!.params).toMatchObject({ cardsCovered: 1, cardsTotal: 2 });
  });

  it("says nothing when the balance covers everything approved", async () => {
    const email = `watch-quiet-${randomUUID()}@example.com`;
    const { token, accountId } = await proAccount(email);
    const savedDesignId = await createSavedDesign(token);
    await commitCard(token, savedDesignId, "Ada", 3);
    await creditWallet(accountId, CARD_TOTAL_MINOR * 3);

    await runWatch(await opsToken()).expect(201);

    expect(await notices(accountId, "wallet_low_balance")).toHaveLength(0);
    expect(mailTo(email)).toHaveLength(0);
  });

  it("counts what is still to be paid for, not what has already gone", async () => {
    const email = `watch-spent-${randomUUID()}@example.com`;
    const { token, accountId } = await proAccount(email);
    const savedDesignId = await createSavedDesign(token);
    const ahead = await commitCard(token, savedDesignId, "Ada", 3);
    const gone = await commitCard(token, savedDesignId, "Grace", 6);
    // Auto-send already ordered and paid for Grace's card this morning. Its
    // money has left the wallet; counting it again as future commitment would
    // warn about a shortfall that does not exist.
    await prisma.occasion.update({ where: { id: gone }, data: { status: "queued" } });
    // An occasion still in the approvals queue costs nothing either — it needs
    // a human before it can — and it is excluded by its dispatch option, which
    // only approval sets to auto_send.
    const recipientId = await createRecipient(token, "Joan");
    await request(app.getHttpServer())
      .post("/occasions")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "achievement", occasionDate: todayIso(), recipientId })
      .expect(201);
    // Enough for exactly the one card that is genuinely still to come.
    await creditWallet(accountId, CARD_TOTAL_MINOR);

    await runWatch(await opsToken()).expect(201);

    expect(ahead).toBeTruthy();
    expect(await notices(accountId, "wallet_low_balance")).toHaveLength(0);
    expect(mailTo(email)).toHaveLength(0);
  });

  it("does not warn about a shortfall the morning's top-up just cleared", async () => {
    const email = `watch-topup-first-${randomUUID()}@example.com`;
    const { token, accountId } = await proAccount(email);
    const savedDesignId = await createSavedDesign(token);
    await commitCard(token, savedDesignId, "Ada", 3);
    await commitCard(token, savedDesignId, "Grace", 6);
    await commitCard(token, savedDesignId, "Joan", 9);
    await creditWallet(accountId, 500); // £5 against ~£12 of cards
    await enableAutoTopUp(token, { enabled: true, thresholdMinor: 1000, amountMinor: 5000 });

    await runWatch(await opsToken()).expect(201);

    // The top-up runs first on purpose. Telling somebody their balance is short
    // and then fixing it in the same run is a warning about nothing.
    expect(invoicesPay).toHaveBeenCalledTimes(1);
    expect(await notices(accountId, "wallet_low_balance")).toHaveLength(0);
  });

  it("still warns when the top-up is not enough to cover what is due", async () => {
    const email = `watch-topup-short-${randomUUID()}@example.com`;
    const { token, accountId } = await proAccount(email);
    const savedDesignId = await createSavedDesign(token);
    // Ten cards at ~£4.05 is more than the £5 top-up adds.
    for (let day = 1; day <= 10; day += 1) {
      await commitCard(token, savedDesignId, `Card${day}`, day);
    }
    await enableAutoTopUp(token, { enabled: true, thresholdMinor: 1000, amountMinor: 500 });

    await runWatch(await opsToken()).expect(201);

    // A top-up is a floor, not a promise to cover everything.
    expect(invoicesPay).toHaveBeenCalledTimes(1);
    const warned = await notices(accountId, "wallet_low_balance");
    expect(warned).toHaveLength(1);
    expect(warned[0]!.body).toContain("of 10 cards");
  });

  it("does not repeat the same warning, but does say when the shortfall moves", async () => {
    const email = `watch-repeat-${randomUUID()}@example.com`;
    const { token, accountId } = await proAccount(email);
    const savedDesignId = await createSavedDesign(token);
    await commitCard(token, savedDesignId, "Ada", 3);
    await commitCard(token, savedDesignId, "Grace", 10);
    await commitCard(token, savedDesignId, "Joan", 20);

    const ops = await opsToken();
    await runWatch(ops).expect(201);
    await runWatch(ops).expect(201);
    // An empty wallet: the first card is the shortfall, told once across both.
    expect(await notices(accountId, "wallet_low_balance")).toHaveLength(1);
    expect(mailTo(email)).toHaveLength(1);

    // They top up enough for two. The first card they cannot cover is now a
    // different card on a different day — genuinely new news.
    await creditWallet(accountId, CARD_TOTAL_MINOR * 2);
    await runWatch(ops).expect(201);

    const warned = await notices(accountId, "wallet_low_balance");
    expect(warned).toHaveLength(2);
    expect(warned[1]!.title).toBe("Your wallet will not cover Joan Recipient's card");
    expect(mailTo(email)).toHaveLength(2);
  });

  it("charges the card on file and credits the wallet when the balance falls through", async () => {
    const email = `watch-topup-${randomUUID()}@example.com`;
    const { token, accountId } = await proAccount(email);
    await creditWallet(accountId, 500); // £5, below a £10 threshold
    await enableAutoTopUp(token, { enabled: true, thresholdMinor: 1000, amountMinor: 5000 });

    const response = await runWatch(await opsToken()).expect(201);
    expect((response.body as WalletWatchResult).toppedUp).toBeGreaterThanOrEqual(1);

    // Charged off-session, against the card we found.
    expect(invoicesPay).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ payment_method: "pm_good", off_session: true }),
    );
    // And credited, with the VAT receipt ADR 0103 promises every top-up.
    const credit = await prisma.walletLedgerEntry.findFirst({
      where: { accountId, type: "topup", amountMinor: 5000 },
    });
    expect(credit).not.toBeNull();
    expect(credit!.receiptPdfUrl).toMatch(/\.pdf$/);
    expect(
      await prisma.walletLedgerEntry.aggregate({
        where: { accountId },
        _sum: { amountMinor: true },
      }),
    ).toMatchObject({ _sum: { amountMinor: 5500 } });
  });

  it("does not charge an account that is above its threshold", async () => {
    const email = `watch-funded-${randomUUID()}@example.com`;
    const { token, accountId } = await proAccount(email);
    await creditWallet(accountId, 5000);
    await enableAutoTopUp(token, { enabled: true, thresholdMinor: 1000, amountMinor: 5000 });

    await runWatch(await opsToken()).expect(201);

    expect(invoicesPay).not.toHaveBeenCalled();
    expect(await prisma.walletLedgerEntry.count({ where: { accountId } })).toBe(1);
  });

  it("stops, and says why, when there is no card it can charge", async () => {
    const email = `watch-nocard-${randomUUID()}@example.com`;
    const { token, accountId } = await proAccount(email);
    // A committed card, so this account stays in the watch's scan after it is
    // paused — the standing-instruction query filters paused accounts out, and
    // without this the "does not try again" assertion below would pass on an
    // account nobody looked at rather than on the guard that refuses it.
    const savedDesignId = await createSavedDesign(token);
    await commitCard(token, savedDesignId, "Ada", 5);
    await creditWallet(accountId, 100);
    await enableAutoTopUp(token, { enabled: true, thresholdMinor: 1000, amountMinor: 5000 });
    paymentMethodsList.mockResolvedValue({ data: [] });

    const ops = await opsToken();
    await runWatch(ops).expect(201);

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.autoTopUpPausedAt).not.toBeNull();
    expect(account.autoTopUpPausedReason).toBe("no_payment_method");

    const paused = await notices(accountId, "auto_top_up_paused");
    expect(paused).toHaveLength(1);
    expect(paused[0]!.body).toContain("do not have a card on file");

    const mail = mailTo(email).filter((m) => m.subject === "Your automatic top-up has stopped");
    expect(mail).toHaveLength(1);

    // Paused means paused: a second run must not try again.
    invoicesCreate.mockClear();
    await runWatch(ops).expect(201);
    expect(invoicesCreate).not.toHaveBeenCalled();
  });

  it("does not retry a paused instruction, even once the card would work", async () => {
    const email = `watch-stay-paused-${randomUUID()}@example.com`;
    const { token, accountId } = await proAccount(email);
    // Committed spend keeps this account inside the watch's scan: the
    // standing-instruction query skips paused accounts, so without this the
    // assertion would pass on an account nobody considered.
    const savedDesignId = await createSavedDesign(token);
    await commitCard(token, savedDesignId, "Ada", 5);
    await creditWallet(accountId, 100);
    await enableAutoTopUp(token, { enabled: true, thresholdMinor: 1000, amountMinor: 5000 });
    // Paused by an earlier failure. The card on file is the healthy one from
    // beforeEach, so nothing but the pause itself stands in the way.
    await prisma.account.update({
      where: { id: accountId },
      data: { autoTopUpPausedAt: new Date(), autoTopUpPausedReason: "card_declined" },
    });

    await runWatch(await opsToken()).expect(201);

    // Resuming is the customer's to do. A bank that declined us once will
    // decline us daily, and a daily failed charge is how an account gets
    // locked by its own bank.
    expect(invoicesPay).not.toHaveBeenCalled();
    expect(invoicesCreate).not.toHaveBeenCalled();
    expect(await prisma.walletLedgerEntry.count({ where: { accountId, amountMinor: 5000 } })).toBe(
      0,
    );
  });

  it("stops on a declined card, and tells them to check it", async () => {
    const email = `watch-declined-${randomUUID()}@example.com`;
    const { token, accountId } = await proAccount(email);
    await creditWallet(accountId, 100);
    await enableAutoTopUp(token, { enabled: true, thresholdMinor: 1000, amountMinor: 5000 });
    invoicesPay.mockRejectedValue({
      type: "StripeCardError",
      code: "card_declined",
      // Stripe's own wording, decline code and all — the sentence a developer
      // reads in the dashboard, and the one a customer must never be shown.
      message: "Your card was declined. decline_code: do_not_honor",
    });

    await runWatch(await opsToken()).expect(201);

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.autoTopUpPausedReason).toBe("card_declined");
    const paused = await notices(accountId, "auto_top_up_paused");
    // Our copy, with something to do about it — not Stripe's raw message.
    expect(paused[0]!.body).toContain("card was declined");
    expect(paused[0]!.body).toContain("Check the card in billing");
    expect(paused[0]!.body).not.toContain("do_not_honor");
    // And nothing was credited for a charge that did not happen.
    expect(await prisma.walletLedgerEntry.count({ where: { accountId, amountMinor: 5000 } })).toBe(
      0,
    );
  });

  it("skips an expired card rather than charging it", async () => {
    const email = `watch-expired-${randomUUID()}@example.com`;
    const { token, accountId } = await proAccount(email);
    await creditWallet(accountId, 100);
    await enableAutoTopUp(token, { enabled: true, thresholdMinor: 1000, amountMinor: 5000 });
    paymentMethodsList.mockResolvedValue({
      data: [{ id: "pm_old", card: { exp_month: 1, exp_year: new Date().getUTCFullYear() - 1 } }],
    });

    await runWatch(await opsToken()).expect(201);

    expect(invoicesPay).not.toHaveBeenCalled();
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.autoTopUpPausedReason).toBe("no_payment_method");
  });

  it("prefers the card the customer already pays us with", async () => {
    const email = `watch-default-${randomUUID()}@example.com`;
    const { token, accountId } = await proAccount(email);
    await creditWallet(accountId, 100);
    await enableAutoTopUp(token, { enabled: true, thresholdMinor: 1000, amountMinor: 5000 });
    const nextYear = new Date().getUTCFullYear() + 2;
    paymentMethodsList.mockResolvedValue({
      data: [
        { id: "pm_newest", card: { exp_month: 12, exp_year: nextYear } },
        { id: "pm_subscription", card: { exp_month: 12, exp_year: nextYear } },
      ],
    });
    customersRetrieve.mockResolvedValue({
      id: "cus_test",
      invoice_settings: { default_payment_method: "pm_subscription" },
    });

    await runWatch(await opsToken()).expect(201);

    expect(invoicesPay).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ payment_method: "pm_subscription" }),
    );
  });

  it("leaves an account that never asked for this alone", async () => {
    const email = `watch-off-${randomUUID()}@example.com`;
    const { accountId } = await proAccount(email);
    await creditWallet(accountId, 100);

    await runWatch(await opsToken()).expect(201);

    expect(invoicesPay).not.toHaveBeenCalled();
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.autoTopUpEnabled).toBe(false);
    expect(account.autoTopUpPausedAt).toBeNull();
  });

  it("resumes a paused instruction when the customer saves it again", async () => {
    const email = `watch-resume-${randomUUID()}@example.com`;
    const { token, accountId } = await proAccount(email);
    await prisma.account.update({
      where: { id: accountId },
      data: {
        autoTopUpEnabled: true,
        autoTopUpPausedAt: new Date(),
        autoTopUpPausedReason: "card_declined",
      },
    });

    await enableAutoTopUp(token, { enabled: true, thresholdMinor: 1500, amountMinor: 2000 });

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.autoTopUpPausedAt).toBeNull();
    expect(account.autoTopUpPausedReason).toBeNull();
    expect(account.autoTopUpThresholdMinor).toBe(1500);
  });

  it("refuses an unattended charge larger than one the customer could make by hand", async () => {
    const email = `watch-bounds-${randomUUID()}@example.com`;
    const { token } = await proAccount(email);
    await request(app.getHttpServer())
      .patch("/wallet/auto-top-up")
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: true, thresholdMinor: 1000, amountMinor: 100_001 })
      .expect(400);
  });

  it("forbids a non-admin from triggering a run", async () => {
    const { token } = await proAccount(`watch-forbidden-${randomUUID()}@example.com`);
    await runWatch(token).expect(403);
  });
});
