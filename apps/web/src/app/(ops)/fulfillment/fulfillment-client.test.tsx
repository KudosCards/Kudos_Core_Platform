import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FulfillmentClient, type FulfillmentJob } from "./fulfillment-client";

const fetchMock = jest.fn();
jest.mock("@/lib/api.client", () => ({
  clientApiFetch: (...args: unknown[]) => fetchMock(...args),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  usePathname: () => "/fulfillment",
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * Marking a card posted is a one-way door: `postedAt` is stamped, the row
 * leaves the queue, and the only action left on a posted card is "Returned to
 * sender", which opens a recovery case and flags the contact's address.
 *
 * The tracking prompt sat in front of that door and let people through when
 * they tried to back out. See ADR 0197.
 */
describe("FulfillmentClient — the tracking prompt before posting", () => {
  const job: FulfillmentJob = {
    id: "job-1",
    status: "printed",
    trackingReference: null,
    labelUrl: null,
    printedAt: new Date().toISOString(),
    postedAt: null,
    deliveredAt: null,
    dueDate: null,
    workingDaysUntilDue: null,
    clickAndDropOrderId: null,
    clickAndDropError: null,
    orderRecipient: {
      shippingAddressCity: "London",
      shippingAddressPostcode: "SW1A 1AA",
      dispatchOption: "asap",
      postageClass: "second_class",
      recipient: { firstName: "Ada", lastName: "Lovelace" },
      savedDesign: { id: "d1", name: "Happy Birthday" },
      occasion: { type: "birthday", occasionDate: new Date().toISOString() },
    },
  };

  const COUNTS = {
    status: { pending: 0, in_progress: 0, printed: 1, posted: 0, delivered: 0 },
    due: { overdue: 0, today: 0, dueSoon: 0, upcoming: 0, noDate: 1 },
    clickAndDropErrors: 0,
  } as never;

  function setup() {
    render(
      <FulfillmentClient
        initialJobs={[job]}
        status="printed"
        due={null}
        counts={COUNTS}
        dueOn={null}
        defaultPrintSize={"a5" as never}
      />,
    );
  }

  // The component fetches shipping and Click & Drop status on mount, so the
  // mock answers those with real shapes. Assertions look only at the
  // transition call.
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("import-status")) {
        return Promise.resolve({
          enabled: false,
          imported: 0,
          errored: 0,
          awaiting: 0,
          recentImports: [],
          recentErrors: [],
        });
      }
      if (String(url).includes("status")) return Promise.resolve({ enabled: false });
      return Promise.resolve({});
    });
  });

  const transitionCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes("/transition"));
  afterEach(() => jest.restoreAllMocks());

  it("does not post the card when the operator backs out of the prompt", async () => {
    // Escape and Cancel both return null. An operator who clicked the wrong
    // row and pressed Escape used to post that card anyway.
    jest.spyOn(window, "prompt").mockReturnValue(null);
    setup();

    await userEvent.click(screen.getByRole("button", { name: "Mark posted" }));

    expect(transitionCalls()).toHaveLength(0);
    // And the card is still in the queue, where they left it.
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("posts with no reference when the prompt is submitted blank", async () => {
    // Deliberately blank is a real answer, and must still post.
    jest.spyOn(window, "prompt").mockReturnValue("");
    setup();

    await userEvent.click(screen.getByRole("button", { name: "Mark posted" }));

    await waitFor(() => expect(transitionCalls()).toHaveLength(1));
    const [, init] = transitionCalls()[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({ toStatus: "posted" });
  });

  it("posts with the reference when one is typed", async () => {
    jest.spyOn(window, "prompt").mockReturnValue("  AB123456789GB  ");
    setup();

    await userEvent.click(screen.getByRole("button", { name: "Mark posted" }));

    await waitFor(() => expect(transitionCalls()).toHaveLength(1));
    const [, init] = transitionCalls()[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({
      toStatus: "posted",
      trackingReference: "AB123456789GB",
    });
  });
});

/**
 * The calendar drill-in and the deadline view both list every still-open card —
 * pending, in progress and printed — with no status filter at all. `advance()`
 * removed the row regardless, on the strength of a comment claiming "the job
 * leaves the current status filter's view".
 *
 * An operator drills into Friday to work twelve cards, marks each printed, and
 * each vanishes. After twelve clicks the screen reads "Nothing in this queue",
 * though all twelve are still printed-but-unposted and still due Friday. They
 * have lost the working list of exactly the cards they now need to post.
 * See ADR 0203.
 */
describe("FulfillmentClient — advancing inside a deadline view", () => {
  const pendingJob: FulfillmentJob = {
    id: "job-2",
    status: "pending",
    trackingReference: null,
    labelUrl: null,
    printedAt: null,
    postedAt: null,
    deliveredAt: null,
    dueDate: new Date().toISOString(),
    workingDaysUntilDue: 0,
    clickAndDropOrderId: null,
    clickAndDropError: null,
    orderRecipient: {
      shippingAddressCity: "London",
      shippingAddressPostcode: "SW1A 1AA",
      dispatchOption: "asap",
      postageClass: "second_class",
      recipient: { firstName: "Grace", lastName: "Hopper" },
      savedDesign: { id: "d1", name: "Happy Birthday" },
      occasion: { type: "birthday", occasionDate: new Date().toISOString() },
    },
  };

  const COUNTS = {
    status: { pending: 1, in_progress: 0, printed: 0, posted: 0, delivered: 0 },
    due: { overdue: 0, today: 1, dueSoon: 0, upcoming: 0, noDate: 0 },
    clickAndDropErrors: 0,
  } as never;

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("import-status")) {
        return Promise.resolve({
          enabled: false,
          imported: 0,
          errored: 0,
          awaiting: 0,
          recentImports: [],
          recentErrors: [],
        });
      }
      if (String(url).includes("/transition")) {
        return Promise.resolve({
          ...pendingJob,
          status: "printed",
          printedAt: new Date().toISOString(),
        });
      }
      if (String(url).includes("status")) return Promise.resolve({ enabled: false });
      return Promise.resolve({});
    });
  });

  /** A calendar drill-in: one deadline day, every open status, no tab pinned. */
  function setupDrillIn() {
    render(
      <FulfillmentClient
        initialJobs={[pendingJob]}
        status={null}
        due={null}
        counts={COUNTS}
        dueOn="2026-09-04"
        defaultPrintSize={"a5" as never}
      />,
    );
  }

  it("keeps a card that is still open after it is marked printed", async () => {
    setupDrillIn();
    await userEvent.click(screen.getByRole("button", { name: "Mark printed" }));

    // Printed is still an open status, so the card is still due that day and
    // still on the operator's list — now showing its new state.
    await waitFor(() => expect(screen.getByRole("button", { name: "Mark posted" })).toBeVisible());
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.queryByText("Nothing in this queue.")).not.toBeInTheDocument();
  });

  it("removes a card from a pinned tab even when its new status is still open", async () => {
    render(
      <FulfillmentClient
        initialJobs={[pendingJob]}
        status="pending"
        due={null}
        counts={COUNTS}
        dueOn={null}
        defaultPrintSize={"a5" as never}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Mark printed" }));

    // Printed is an open status, but this view is the Pending tab: a printed
    // card does not belong in it. "Still open" and "still in this view" are
    // different questions, and only the second one decides.
    await waitFor(() => expect(screen.getByText("Nothing in this queue.")).toBeInTheDocument());
  });

  it("removes a card once it is genuinely out of the view", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("import-status")) {
        return Promise.resolve({
          enabled: false,
          imported: 0,
          errored: 0,
          awaiting: 0,
          recentImports: [],
          recentErrors: [],
        });
      }
      if (String(url).includes("/transition")) {
        return Promise.resolve({ ...pendingJob, status: "posted" });
      }
      if (String(url).includes("status")) return Promise.resolve({ enabled: false });
      return Promise.resolve({});
    });
    jest.spyOn(window, "prompt").mockReturnValue("");
    render(
      <FulfillmentClient
        initialJobs={[{ ...pendingJob, status: "printed", printedAt: new Date().toISOString() }]}
        status={null}
        due={null}
        counts={COUNTS}
        dueOn="2026-09-04"
        defaultPrintSize={"a5" as never}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Mark posted" }));

    // Posted is not an open status: the card has left this view for real.
    await waitFor(() => expect(screen.getByText("Nothing in this queue.")).toBeInTheDocument());
  });
});
