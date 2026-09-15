import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Recipient, ReturnCase } from "@kudos/shared-types";
import { ReturnRecoveryPanel } from "./return-recovery-panel";

const fetchMock = jest.fn();
jest.mock("@/lib/api.client", () => ({
  clientApiFetch: (...args: unknown[]) => fetchMock(...args),
}));

/**
 * A contact's other cards, already paid for, addressed to the place a card just
 * came back from. The platform holds them — and they stay held until somebody
 * points them at the corrected address.
 *
 * This panel is the one moment the customer is already dealing with that
 * address, which makes it the cheapest possible place to fix every card at once.
 * See docs/returned-address-hold-plan.md, phase 3.
 */
const recipient = {
  id: "r1",
  firstName: "Freddie",
  lastName: "Farrow",
  addressLine1: "4 Mill Lane",
  addressLine2: null,
  addressCity: "Kingston upon Hull",
  addressPostcode: "HU5 2QR",
  addressVerificationRequired: true,
} as unknown as Recipient;

function openCase(over: Partial<ReturnCase> = {}): ReturnCase {
  return {
    id: "case-1",
    orderNumber: 1024,
    recipientId: "r1",
    recipientName: "Freddie Farrow",
    occasionType: "birthday",
    occasionTitle: null,
    occasionDate: null,
    reason: "moved",
    status: "awaiting_resend",
    freeRecoveryUsed: false,
    addressUpdatedAt: new Date().toISOString(),
    resolvedAt: null,
    resolution: null,
    returnedAt: new Date().toISOString(),
    waiting: { count: 3, canRepoint: true },
    resend: { hasRecipientAddress: true, birthdayPassed: false, daysSinceOccasion: null },
    ...over,
  } as unknown as ReturnCase;
}

function setup(rtsCase: ReturnCase) {
  render(
    <ReturnRecoveryPanel
      recipient={recipient}
      initialCases={[rtsCase]}
      onRecipientChanged={() => {}}
    />,
  );
}

describe("Return recovery — the other cards waiting on this address", () => {
  beforeEach(() => fetchMock.mockReset());

  it("says how many other cards are stuck behind it", () => {
    setup(openCase());

    expect(screen.getByText(/3 more cards for Freddie Farrow are waiting/)).toBeInTheDocument();
  });

  it("reads correctly for a single card", () => {
    // "1 more cards are waiting" is the sort of line that makes a warning look
    // automated, and this one is asking somebody to act.
    setup(openCase({ waiting: { count: 1, canRepoint: true } } as Partial<ReturnCase>));

    expect(screen.getByText(/1 more card for Freddie Farrow is waiting/)).toBeInTheDocument();
  });

  it("sends them to the new address in one click", async () => {
    fetchMock.mockResolvedValue(
      openCase({ waiting: { count: 0, canRepoint: false } } as Partial<ReturnCase>),
    );
    setup(openCase());

    await userEvent.click(screen.getByRole("button", { name: /Send them to the new address/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/returns/case-1/repoint");
  });

  it("does not offer it before the corrected address is known", () => {
    // Re-pointing then would write the returned address back over itself and
    // call the cards fixed.
    setup(openCase({ waiting: { count: 2, canRepoint: false } } as Partial<ReturnCase>));

    expect(screen.getByRole("button", { name: /Send them to the new address/ })).toBeDisabled();
  });

  it("says nothing when no other card is waiting", () => {
    // The discriminator: most returns have no other card behind them, and a
    // panel that always claims some is one nobody reads.
    setup(openCase({ waiting: { count: 0, canRepoint: false } } as Partial<ReturnCase>));

    expect(screen.queryByText(/waiting on this address/)).not.toBeInTheDocument();
  });
});
