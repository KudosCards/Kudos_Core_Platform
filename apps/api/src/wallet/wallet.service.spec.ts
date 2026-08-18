import type Stripe from "stripe";
import { WalletService } from "./wallet.service";

/**
 * Unit coverage for the VAT-receipt capture on a wallet top-up. The full credit
 * path is exercised by wallet.e2e-spec; this isolates the Stripe-invoice lookup
 * (which the e2e can't hit without a real Stripe call). See ADR 0103.
 */
type Args = ConstructorParameters<typeof WalletService>;

interface FetchReceipt {
  fetchTopupReceipt(session: Pick<Stripe.Checkout.Session, "id" | "invoice">): Promise<{
    stripeInvoiceId?: string;
    receiptUrl?: string | null;
    receiptPdfUrl?: string | null;
  }>;
}

function makeService(retrieve: jest.Mock): FetchReceipt {
  const stripe = { invoices: { retrieve } } as unknown as Args[3];
  const service = new WalletService(
    undefined as unknown as Args[0],
    undefined as unknown as Args[1],
    undefined as unknown as Args[2],
    stripe,
    undefined as unknown as Args[4],
    undefined as unknown as Args[5],
  );
  return service as unknown as FetchReceipt;
}

describe("WalletService — top-up VAT receipt capture", () => {
  it("returns the invoice's PDF + hosted URL when the session carries an invoice", async () => {
    const retrieve = jest.fn().mockResolvedValue({
      id: "in_test_1",
      hosted_invoice_url: "https://invoice.stripe.com/i/test",
      invoice_pdf: "https://invoice.stripe.com/i/test/pdf",
    });
    const service = makeService(retrieve);

    const result = await service.fetchTopupReceipt({ id: "cs_1", invoice: "in_test_1" });

    expect(retrieve).toHaveBeenCalledWith("in_test_1");
    expect(result).toEqual({
      stripeInvoiceId: "in_test_1",
      receiptUrl: "https://invoice.stripe.com/i/test",
      receiptPdfUrl: "https://invoice.stripe.com/i/test/pdf",
    });
  });

  it("returns {} and makes no Stripe call when the session has no invoice", async () => {
    const retrieve = jest.fn();
    const service = makeService(retrieve);

    expect(await service.fetchTopupReceipt({ id: "cs_1", invoice: null })).toEqual({});
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("swallows a lookup failure and returns {} (never blocks the credit)", async () => {
    const retrieve = jest.fn().mockRejectedValue(new Error("stripe down"));
    const service = makeService(retrieve);

    expect(await service.fetchTopupReceipt({ id: "cs_1", invoice: "in_test_1" })).toEqual({});
  });
});
