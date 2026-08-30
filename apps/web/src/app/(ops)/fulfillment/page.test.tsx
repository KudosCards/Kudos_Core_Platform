import FulfillmentPage from "./page";

const serverApiFetch = jest.fn();
jest.mock("@/lib/api.server", () => ({
  serverApiFetch: (...args: unknown[]) => serverApiFetch(...args),
}));

/**
 * The queue renders a tab for all seven statuses with live counts. The server
 * page validated the `status` param against a hand-written list of six, so
 * "returned to sender" fell back to `pending`: an operator saw "returned to
 * sender 7", clicked it, and landed on the Pending queue with the Pending tab
 * highlighted — no error, no empty state, and no other route to those cards
 * from this screen. See ADR 0202.
 */
describe("FulfillmentPage — the status tab the server accepted", () => {
  beforeEach(() => {
    serverApiFetch.mockReset();
    serverApiFetch.mockImplementation((path: string) => {
      if (String(path).includes("/counts")) return Promise.resolve(null);
      if (String(path).includes("card-size")) return Promise.resolve({ size: "a5" });
      return Promise.resolve({ items: [], total: 0, page: 1, perPage: 100 });
    });
  });

  const jobsQuery = () =>
    String(serverApiFetch.mock.calls.find(([p]) => String(p).includes("/fulfillment/jobs"))![0]);

  async function renderFor(status: string) {
    const element = (await FulfillmentPage({
      searchParams: Promise.resolve({ status }),
    })) as { props: { status: string | null } };
    return element;
  }

  it.each([
    "pending",
    "in_progress",
    "printed",
    "posted",
    "delivered",
    "returned_to_sender",
    "failed",
  ])("honours the %s tab rather than falling back to pending", async (status) => {
    const element = await renderFor(status);
    expect(jobsQuery()).toContain(`status=${status}`);
    expect(element.props.status).toBe(status);
  });

  it("still falls back to pending for a status that is not one", async () => {
    const element = await renderFor("not_a_status");
    expect(jobsQuery()).toContain("status=pending");
    // Deliberately "pending", not null: on the landing view a tab is always
    // highlighted, so the fallback has to name the tab it fell back to.
    expect(element.props.status).toBe("pending");
  });
});
