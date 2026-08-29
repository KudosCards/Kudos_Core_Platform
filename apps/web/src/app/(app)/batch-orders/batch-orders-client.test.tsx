import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  CARD_PRICE_MINOR,
  POSTAGE_MINOR,
  VAT_RATE_PERCENT,
  type AccountPricing,
} from "@kudos/shared-types";
import { BatchOrdersClient } from "./batch-orders-client";
import type { OccasionWithRecipient } from "../approvals/approvals-client";

jest.mock("@/lib/api.client", () => ({ clientApiFetch: jest.fn() }));

/**
 * Checkout — the last screen before money changes hands.
 *
 * Two things here are load-bearing. The per-order cap is a plan entitlement, so
 * letting a selection past it means an order the API will refuse after the
 * customer has committed to it. And the list was capped at fifty and silent, so
 * a school with more approved cards than that saw part of what they had already
 * decided to send, with no sign the rest existed. See ADR 0173 on why silence
 * is the defect.
 */
describe("BatchOrdersClient", () => {
  const pricing: AccountPricing = {
    cardPriceMinor: CARD_PRICE_MINOR,
    cardDiscountPercent: 0,
    fullCardPriceMinor: CARD_PRICE_MINOR,
    postageMinor: POSTAGE_MINOR,
    vatRatePercent: VAT_RATE_PERCENT,
  };

  const card = (i: number): OccasionWithRecipient =>
    ({
      id: `occ-${i}`,
      type: "birthday",
      occasionDate: new Date(Date.now() + (i + 3) * 86_400_000).toISOString(),
      status: "approved",
      recipient: { id: `r-${i}`, firstName: "Child", lastName: `Number${i}` },
    }) as unknown as OccasionWithRecipient;

  function setup({
    count = 3,
    totalApproved = count,
    maxPerOrder = 10,
  }: { count?: number; totalApproved?: number; maxPerOrder?: number } = {}) {
    render(
      <BatchOrdersClient
        initialOccasions={Array.from({ length: count }, (_, i) => card(i))}
        totalApproved={totalApproved}
        initialUnfinishedOrders={[]}
        walletBalanceMinor={0}
        pricing={pricing}
        maxPerOrder={maxPerOrder}
      />,
    );
  }

  it("says so when more are approved than it could fetch", () => {
    // A customer who has approved 137 cards and is shown 100 has no way to know
    // the other 37 exist — they are cards they already chose to send.
    setup({ count: 100, totalApproved: 137 });
    expect(
      screen.getByText(/Showing the first 100 of 137 approved and ready to send/),
    ).toBeInTheDocument();
  });

  it("stays quiet when everything approved is on screen", () => {
    setup({ count: 3, totalApproved: 3 });
    expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument();
  });

  /** Tick every occasion on the page. */
  async function selectAll() {
    for (const box of screen.getAllByRole("checkbox")) {
      await userEvent.click(box);
    }
  }

  it("warns as soon as a selection passes the plan's per-order cap", async () => {
    // The cap is an entitlement the API enforces, so an over-sized selection is
    // an order that will be refused after the customer has committed to it.
    // Warned live, while they can still act on it.
    setup({ count: 3, maxPerOrder: 2 });
    await selectAll();

    // Matched on "Deselect", which only the warning says — the page's intro
    // paragraph mentions the cap too, so asserting on that phrase would pass
    // whether or not the guard fired.
    expect(screen.getByText(/Deselect\s*1\s*to continue/)).toBeInTheDocument();
  });

  it("says nothing at exactly the cap", async () => {
    // The boundary. Off by one here either blocks a legitimate order or lets
    // one through that the API will then reject.
    setup({ count: 3, maxPerOrder: 3 });
    await selectAll();

    expect(screen.getByText(/3 of 3 selected/)).toBeInTheDocument();
    expect(screen.queryByText(/Deselect/)).not.toBeInTheDocument();
  });
});
