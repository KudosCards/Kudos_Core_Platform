import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrderCockpit } from "./order-cockpit-client";
import type { AdminOrderLine } from "@kudos/shared-types";

const fetchMock = jest.fn();
jest.mock("@/lib/api.client", () => ({
  clientApiFetch: (...args: unknown[]) => fetchMock(...args),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));

/**
 * The order cockpit carries a second copy of the fulfilment queue's advance
 * button, and carried the same tracking-prompt bug. Covered separately because
 * "the other copy was fixed too" is the kind of claim that needs a test rather
 * than a reading of the diff. See ADR 0197.
 */
describe("OrderCockpit — the tracking prompt before posting", () => {
  const line: AdminOrderLine = {
    orderRecipientId: "00000000-0000-4000-8000-000000000001",
    jobId: "00000000-0000-4000-8000-000000000002",
    recipientName: "Ada Lovelace",
    designName: "Happy Birthday",
    postageClass: "second_class",
    dispatchOption: "asap",
    occasionType: "birthday",
    occasionDate: new Date(),
    dueDate: null,
    jobStatus: "printed",
    trackingReference: null,
    labelUrl: null,
    printedAt: new Date(),
    postedAt: null,
    deliveredAt: null,
    clickAndDropImported: false,
    clickAndDropError: null,
  };

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({});
  });
  afterEach(() => jest.restoreAllMocks());

  function setup() {
    render(
      <OrderCockpit
        orderId="00000000-0000-4000-8000-000000000003"
        orderStatus={"paid" as never}
        lines={[line]}
        shippingEnabled={false}
        clickAndDropEnabled={false}
        isSuperAdmin={false}
      />,
    );
  }

  it("does not post the card when the operator backs out of the prompt", async () => {
    jest.spyOn(window, "prompt").mockReturnValue(null);
    setup();

    await userEvent.click(screen.getByRole("button", { name: "Mark posted" }));

    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("/transition")),
    ).toHaveLength(0);
  });
});
