import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CalendarOccasion } from "@kudos/shared-types";
import { clientApiFetch } from "@/lib/api.client";
import { CalendarClient } from "./calendar-client";

jest.mock("@/lib/api.client", () => ({ clientApiFetch: jest.fn() }));

/**
 * The calendar's list view, and specifically its multi-select.
 *
 * A super admin reported that the boxes beside the names cannot be ticked, so
 * an order has to be built one contact at a time. These tests establish what
 * the list view actually offers for each occasion status, which is the thing
 * the report is really about.
 */
describe("CalendarClient list view selection", () => {
  const TODAY = "2026-09-01T00:00:00.000Z";

  // The component picks its default view from a media query (list on a phone,
  // month on a desktop). jsdom has no matchMedia; report a wide screen so these
  // start on the month grid and reach the list the way a desktop user does.
  beforeAll(() => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
  });

  const occasion = (
    id: string,
    status: CalendarOccasion["status"],
    firstName: string,
  ): CalendarOccasion =>
    ({
      id,
      recipientId: `r-${id}`,
      type: "birthday",
      source: "recipient_key_date",
      title: null,
      // Well inside the list's forward window from TODAY.
      occasionDate: new Date("2026-09-10T00:00:00.000Z"),
      dispatchDate: null,
      status,
      recipient: { firstName, lastName: "Test" },
      order: null,
    }) as unknown as CalendarOccasion;

  /** The calendar refetches on mount, so the mock has to answer both endpoints
   * with the same occasions the component was seeded with — otherwise the list
   * is empty by the time anything is asserted, for reasons that have nothing to
   * do with what is being tested. */
  function mockApi(occasions: CalendarOccasion[]) {
    (clientApiFetch as jest.Mock).mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith("/events")
          ? []
          : { items: occasions, total: occasions.length, truncated: false },
      ),
    );
  }

  async function renderList(occasions: CalendarOccasion[]) {
    mockApi(occasions);
    render(
      <CalendarClient
        initialOccasions={occasions}
        initialTruncated={false}
        initialTotal={occasions.length}
        initialEvents={[]}
        todayIso={TODAY}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "list" }));
  }

  it("offers a tickable box for an approved occasion", async () => {
    await renderList([occasion("a", "approved", "Approved")]);

    const boxes = screen.getAllByTitle("Select to include in an order");
    expect(boxes).toHaveLength(1);

    await userEvent.click(boxes[0]!);
    expect(screen.getByText(/1 approved card selected/)).toBeInTheDocument();
  });

  it("offers no tickable box for an occasion awaiting approval", async () => {
    await renderList([occasion("p", "pending_approval", "Pending")]);

    expect(screen.getByText(/Pending Test/)).toBeInTheDocument();
    expect(screen.queryAllByTitle("Select to include in an order")).toHaveLength(0);
  });

  it("offers no tickable box for a scheduled occasion", async () => {
    await renderList([occasion("s", "scheduled", "Scheduled")]);

    expect(screen.getByText(/Scheduled Test/)).toBeInTheDocument();
    expect(screen.queryAllByTitle("Select to include in an order")).toHaveLength(0);
  });

  it("ticks several at once and carries them all into one order", async () => {
    await renderList([
      occasion("a1", "approved", "First"),
      occasion("a2", "approved", "Second"),
      occasion("a3", "approved", "Third"),
    ]);

    const boxes = screen.getAllByTitle("Select to include in an order");
    expect(boxes).toHaveLength(3);
    for (const box of boxes) await userEvent.click(box);

    expect(screen.getByText(/3 approved cards selected/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Create order/ });
    expect(link).toHaveAttribute("href", expect.stringContaining("a1,a2,a3"));
  });

  it("draws no look-alike square beside an occasion that cannot be ticked", async () => {
    // The reported defect. An inert span the same size and shape as the real
    // checkbox sat beside every unapproved occasion, so a calendar with nothing
    // approved read as a column of boxes that refuse to tick. A box now appears
    // only where it can be ticked.
    const pending = [occasion("p", "pending_approval", "Pending")];
    mockApi(pending);
    const { container } = render(
      <CalendarClient
        initialOccasions={pending}
        initialTruncated={false}
        initialTotal={1}
        initialEvents={[]}
        todayIso={TODAY}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "list" }));

    expect(container.querySelectorAll("span[aria-hidden][title]")).toHaveLength(0);
  });

  it("says how many are ready to order, and routes the rest to Approvals", async () => {
    await renderList([
      occasion("a1", "approved", "Ready"),
      occasion("p1", "pending_approval", "Waiting"),
      occasion("p2", "pending_approval", "AlsoWaiting"),
    ]);

    // The counts are split across a <strong>, so match on the bar's own text.
    const bar = screen.getByText(/ready to order/).closest("div")!;
    expect(bar.textContent).toContain("1 card is ready to order");
    expect(bar.textContent).toContain("2 still need approving");
    expect(screen.getByRole("link", { name: /Review & approve/ })).toHaveAttribute(
      "href",
      "/approvals",
    );
  });

  it("selects every ready card at once, and clears them again", async () => {
    await renderList([
      occasion("a1", "approved", "First"),
      occasion("a2", "approved", "Second"),
      occasion("a3", "approved", "Third"),
    ]);

    await userEvent.click(screen.getByRole("button", { name: "Select all 3" }));
    expect(screen.getByText(/3 approved cards selected/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByText(/approved cards selected/)).not.toBeInTheDocument();
  });

  it("select-all covers only what can be ordered, not the whole window", async () => {
    await renderList([
      occasion("a1", "approved", "Ready"),
      occasion("p1", "pending_approval", "Waiting"),
      occasion("s1", "scheduled", "Later"),
    ]);

    await userEvent.click(screen.getByRole("button", { name: "Select all 1" }));

    expect(screen.getByText(/1 approved card selected/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Create order/ });
    expect(link).toHaveAttribute("href", "/batch-orders?occasions=a1");
  });

  it("tells a reader with nothing approved why there is nothing to tick", async () => {
    await renderList([occasion("p1", "pending_approval", "Waiting")]);

    expect(screen.getByText(/No cards here are ready to order yet/)).toBeInTheDocument();
    expect(screen.queryAllByTitle("Select to include in an order")).toHaveLength(0);
  });
});
