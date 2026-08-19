import type Stripe from "stripe";
import type { PrismaService } from "../prisma/prisma.service";
import { SubscriptionInvoicesService } from "./subscription-invoices.service";

/**
 * The backfill, against a mocked Stripe and Prisma — no network, no database.
 * What these pin is the part that would silently produce wrong money: how pages
 * are walked, what counts as subscription income, and that a bad invoice can't
 * abandon the rest of the history.
 *
 * The record/upsert path itself is covered end-to-end in webhooks.e2e-spec
 * against a real database and real signed webhooks.
 */
/** The first argument of a mock's first (or Nth) call, typed. `mock.calls` is
 *  `any[]`, which the lint rules rightly won't let us index into blind. */
function callArg<T>(mock: jest.Mock, index = 0): T {
  const calls: [T][] = mock.mock.calls as [T][];
  const call = calls[index];
  if (!call) {
    throw new Error(`Expected the mock to have been called at least ${index + 1} time(s)`);
  }
  return call[0];
}

describe("SubscriptionInvoicesService", () => {
  function invoice(overrides: Partial<Stripe.Invoice> & { id: string }): Stripe.Invoice {
    return {
      customer: "cus_1",
      amount_paid: 997,
      currency: "gbp",
      status: "paid",
      billing_reason: "subscription_cycle",
      created: 1_780_000_000,
      period_start: 1_780_000_000,
      period_end: 1_782_000_000,
      status_transitions: { paid_at: 1_780_000_000 },
      hosted_invoice_url: null,
      invoice_pdf: null,
      parent: { type: "subscription_details", subscription_details: { subscription: "sub_1" } },
      ...overrides,
    } as unknown as Stripe.Invoice;
  }

  function build(pages: { data: Stripe.Invoice[]; has_more: boolean }[]) {
    const list = jest.fn();
    for (const page of pages) list.mockResolvedValueOnce(page);
    const stripe = { invoices: { list } } as unknown as Stripe;

    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      subscriptionInvoice: { upsert },
      account: { findUnique: jest.fn().mockResolvedValue({ id: "acc_1" }) },
      subscription: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;

    return { service: new SubscriptionInvoicesService(prisma, stripe), list, upsert };
  }

  it("records a paid subscription invoice with its gross amount and Stripe's paid date", async () => {
    const { service, upsert } = build([
      { data: [invoice({ id: "in_1", amount_paid: 1997 })], has_more: false },
    ]);

    const summary = await service.backfill();

    expect(summary).toMatchObject({ scanned: 1, recorded: 1, notSubscription: 0, unmatched: 0 });
    const args = callArg<{
      where: { stripeInvoiceId: string };
      create: { amountPaidMinor: number; paidAt: Date; accountId: string };
    }>(upsert);
    // Keyed on Stripe's id — the whole basis of running this alongside webhooks.
    expect(args.where.stripeInvoiceId).toBe("in_1");
    expect(args.create.amountPaidMinor).toBe(1997);
    expect(args.create.paidAt.toISOString()).toBe(new Date(1_780_000_000 * 1000).toISOString());
    expect(args.create.accountId).toBe("acc_1");
  });

  it("walks every page, continuing from the last invoice of the previous one", async () => {
    const { service, list } = build([
      { data: [invoice({ id: "in_1" }), invoice({ id: "in_2" })], has_more: true },
      { data: [invoice({ id: "in_3" })], has_more: false },
    ]);

    const summary = await service.backfill();

    expect(summary.scanned).toBe(3);
    expect(summary.recorded).toBe(3);
    expect(list).toHaveBeenCalledTimes(2);
    expect(callArg<{ starting_after?: string }>(list, 1).starting_after).toBe("in_2");
  });

  it("asks Stripe only for paid invoices", async () => {
    const { service, list } = build([{ data: [], has_more: false }]);

    await service.backfill();

    expect(callArg<{ status?: string }>(list).status).toBe("paid");
  });

  it("skips an invoice with no subscription behind it", async () => {
    // A card-order invoice, or a one-off raised by hand. Counting it would make
    // "subscription spend" quietly include things that aren't subscriptions.
    const { service, upsert } = build([
      { data: [invoice({ id: "in_1", parent: null })], has_more: false },
    ]);

    const summary = await service.backfill();

    expect(summary).toMatchObject({ scanned: 1, recorded: 0, notSubscription: 1 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("counts a subscription invoice it can't attribute, rather than inventing an account", async () => {
    const { service, upsert } = build([{ data: [invoice({ id: "in_1" })], has_more: false }]);
    // Neither the customer nor the subscription resolves.
    const prisma = (service as unknown as { prisma: PrismaService }).prisma;
    (prisma.account.findUnique as jest.Mock).mockResolvedValue(null);

    const summary = await service.backfill();

    expect(summary).toMatchObject({ scanned: 1, recorded: 0, unmatched: 1 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("carries on when one invoice fails, rather than abandoning the history", async () => {
    const { service, upsert } = build([
      { data: [invoice({ id: "in_1" }), invoice({ id: "in_2" })], has_more: false },
    ]);
    upsert.mockRejectedValueOnce(new Error("deadlock"));

    const summary = await service.backfill();

    expect(summary.scanned).toBe(2);
    expect(summary.recorded).toBe(1);
  });

  it("reports truncation instead of pretending it finished", async () => {
    // Every page says there's more; the run must stop and say so.
    const list = jest.fn().mockResolvedValue({ data: [invoice({ id: "in_x" })], has_more: true });
    const stripe = { invoices: { list } } as unknown as Stripe;
    const prisma = {
      subscriptionInvoice: { upsert: jest.fn().mockResolvedValue({}) },
      account: { findUnique: jest.fn().mockResolvedValue({ id: "acc_1" }) },
      subscription: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;

    const summary = await new SubscriptionInvoicesService(prisma, stripe).backfill();

    expect(summary.truncated).toBe(true);
  });
});
