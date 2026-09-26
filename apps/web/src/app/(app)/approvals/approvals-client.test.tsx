import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApprovalsClient, type OccasionWithRecipient } from "./approvals-client";

const fetchMock = jest.fn();
jest.mock("@/lib/api.client", () => ({
  clientApiFetch: (...args: unknown[]) => fetchMock(...args),
}));

/**
 * Approvals, where a school lost ten birthdays.
 *
 * They faced a queue full of dates that had already gone and cleared it by
 * hand — twenty-seven clicks of "Skip" at about one a second. Ten were live
 * birthdays weeks away. Skipping was a one-way door, so the cards they paid for
 * fifteen minutes later went out as one undated batch. See ADR 0174.
 *
 * These cover the three things that changed: skipping can be taken back, a
 * backlog can be cleared in one act, and a queue longer than one page says so.
 */
describe("ApprovalsClient", () => {
  const person = (i: number): OccasionWithRecipient =>
    ({
      id: `occ-${i}`,
      type: "birthday",
      occasionDate: new Date(Date.now() + (i + 3) * 86_400_000).toISOString(),
      // A queue row carries the dispatch date it was scheduled with. Approving
      // for auto-send re-times it server-side, so this value is what a stale
      // "Posts around" line would show — without it here, a test asserting that
      // line stays away passes whether or not the code keeps the old date.
      dispatchDate: new Date(Date.now() + (i + 1) * 86_400_000).toISOString(),
      status: "pending_approval",
      recipient: {
        id: `r-${i}`,
        firstName: "Child",
        lastName: `Number${i}`,
        addressLine1: "1 Test Street",
        addressCity: "London",
        addressPostcode: "SW1A 1AA",
      },
    }) as unknown as OccasionWithRecipient;

  /** Approved, but waiting for somebody to place an order. */
  const awaiting = (
    id: string,
    dispatchDate: string,
    name = "Ryan Mafukidze",
  ): OccasionWithRecipient =>
    ({
      id,
      type: "birthday",
      occasionDate: "2026-10-03T00:00:00.000Z",
      dispatchDate,
      status: "approved",
      dispatchOption: "asap",
      savedDesignId: "d1",
      recipient: { id: `r-${id}`, firstName: name.split(" ")[0], lastName: name.split(" ")[1] },
    }) as unknown as OccasionWithRecipient;

  function setupAwaiting(items: OccasionWithRecipient[], total = items.length) {
    render(
      <ApprovalsClient
        initialOccasions={[]}
        totalPending={0}
        initialScheduledSends={[]}
        awaitingOrder={items}
        totalAwaitingOrder={total}
        todayIso="2026-09-26"
        savedDesigns={[{ id: "d1", name: "Happy Birthday" } as never]}
        autoSendEnabled
        clickAndForgetRunning={false}
      />,
    );
  }

  function setup(
    count = 3,
    totalPending = count,
    autoSendEnabled = false,
    clickAndForgetRunning = false,
  ) {
    const occasions = Array.from({ length: count }, (_, i) => person(i));
    render(
      <ApprovalsClient
        initialOccasions={occasions}
        totalPending={totalPending}
        initialScheduledSends={[]}
        awaitingOrder={[]}
        totalAwaitingOrder={0}
        todayIso="2026-09-26"
        savedDesigns={[
          { id: "d1", name: "Happy Birthday" } as never,
          { id: "d2", name: "Well Done" } as never,
        ]}
        autoSendEnabled={autoSendEnabled}
        clickAndForgetRunning={clickAndForgetRunning}
      />,
    );
    return { occasions };
  }

  /** Tick everything and choose the design a bulk approve will use. */
  async function tickAllWithDesign(designId = "d1") {
    await userEvent.click(screen.getByRole("checkbox", { name: /Select all/ }));
    // By value: every row carries its own picker with the same option labels,
    // so selecting by name finds several.
    await userEvent.selectOptions(
      screen.getByLabelText("Design to approve the selected cards with"),
      designId,
    );
  }

  beforeEach(() => fetchMock.mockReset());

  const rowFor = (i: number) =>
    screen.getByText(`Child Number${i}`, { selector: "p" }).closest(".card") as HTMLElement;

  it("offers a way back the moment something is skipped", async () => {
    // The whole point. Before this the row simply vanished and the occasion was
    // gone for the year, with nothing in the product able to undo it.
    fetchMock.mockResolvedValue({});
    setup(3);

    await userEvent.click(within(rowFor(0)).getByRole("button", { name: "Skip" }));

    await waitFor(() => expect(screen.getByText(/Changed your mind/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Restore\s*Child Number0/ })).toBeInTheDocument();
    // …and it has left the queue: two rows remain, not three. Asserted on the
    // rows rather than the name, which is still on screen — inside the button
    // offering to put it back.
    expect(screen.getAllByRole("button", { name: "Skip" })).toHaveLength(2);
  });

  it("puts a restored birthday back in the queue", async () => {
    fetchMock.mockImplementation((path: string) =>
      path.endsWith("/unskip") ? Promise.resolve(person(0)) : Promise.resolve({}),
    );
    setup(3);

    await userEvent.click(within(rowFor(0)).getByRole("button", { name: "Skip" }));
    await screen.findByText(/Changed your mind/);
    await userEvent.click(screen.getByRole("button", { name: /Restore\s*Child Number0/ }));

    await waitFor(() => expect(screen.getByText("Child Number0")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/occasions/occ-0/unskip", { method: "POST" });
    expect(screen.queryByText(/Changed your mind/)).not.toBeInTheDocument();
  });

  it("clears a backlog in one act rather than one click per row", async () => {
    // Twenty-seven clicks at one a second is what caused the overshoot.
    fetchMock.mockResolvedValue({});
    setup(3);

    await userEvent.click(screen.getByLabelText(/Select all 3/));
    await userEvent.click(screen.getByRole("button", { name: /Skip 3 selected/ }));

    await waitFor(() => expect(screen.getByText(/Skipped 3 cards/)).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByText(/Nothing waiting for approval/)).toBeInTheDocument();
  });

  it("keeps every card of a bulk skip undoable", async () => {
    // A bulk action that cannot be undone is the original mistake with a faster
    // button on it.
    fetchMock.mockResolvedValue({});
    setup(3);

    await userEvent.click(screen.getByLabelText(/Select all 3/));
    await userEvent.click(screen.getByRole("button", { name: /Skip 3 selected/ }));

    await waitFor(() => expect(screen.getByText(/Skipped 3 cards/)).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /^Restore/ })).toHaveLength(3);
  });

  it("keeps what already succeeded undoable when a bulk skip fails partway", async () => {
    // Whatever went through is skipped whether or not the rest did, so the undo
    // strip has to reflect exactly that — silently dropping them would leave
    // birthdays destroyed with no way back and no sign anything happened.
    let calls = 0;
    fetchMock.mockImplementation(() => {
      calls += 1;
      return calls === 2 ? Promise.reject(new Error("boom")) : Promise.resolve({});
    });
    setup(3);

    await userEvent.click(screen.getByLabelText(/Select all 3/));
    await userEvent.click(screen.getByRole("button", { name: /Skip 3 selected/ }));

    await waitFor(() => expect(screen.getByText(/Skipped 1 card/)).toBeInTheDocument());
    expect(screen.getAllByRole("button", { name: /^Restore/ })).toHaveLength(1);
  });

  it("says so when more are waiting than it could fetch", async () => {
    setup(3, 137);
    expect(screen.getByText(/Showing the first 3 of 137 waiting for approval/)).toBeInTheDocument();
  });

  it("stays quiet when the queue fits", async () => {
    setup(3, 3);
    expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument();
  });

  describe("approving a whole selection with one design", () => {
    it("sends every ticked occasion in one request, with the chosen design", async () => {
      // The bottleneck this closes: approving is where the design is chosen, so
      // "this card, to these three, each on their day" was three separate acts.
      fetchMock.mockResolvedValue({ approvedIds: ["occ-0", "occ-1", "occ-2"], failed: [] });
      setup(3);
      await tickAllWithDesign();

      await userEvent.click(screen.getByRole("button", { name: "Approve 3 selected" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [path, init] = fetchMock.mock.calls[0] as [string, { body: string }];
      expect(path).toBe("/occasions/approve-bulk");
      expect(JSON.parse(init.body)).toEqual({
        occasionIds: ["occ-0", "occ-1", "occ-2"],
        savedDesignId: "d1",
        dispatchOption: "asap",
      });
    });

    it("cannot approve until a design is chosen", async () => {
      setup(3);
      await userEvent.click(screen.getByRole("checkbox", { name: /Select all/ }));

      expect(screen.getByRole("button", { name: "Approve 3 selected" })).toBeDisabled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("clears the approved rows and keeps the ones it could not approve", async () => {
      fetchMock.mockResolvedValue({
        approvedIds: ["occ-0", "occ-2"],
        failed: [
          {
            occasionId: "occ-1",
            recipientName: "Child Number1",
            reason: "Auto-send needs a recipient with a postal address",
          },
        ],
      });
      setup(3);
      await tickAllWithDesign();

      await userEvent.click(screen.getByRole("button", { name: "Approve 3 selected" }));

      await waitFor(() => expect(screen.queryByText("Child Number0")).not.toBeInTheDocument());
      expect(screen.queryByText("Child Number2")).not.toBeInTheDocument();
      // The one that failed is still in the queue, where it can be fixed — and
      // also named in the notice, which is why this looks for the row's own
      // heading rather than the name anywhere on the page.
      expect(screen.getByText("Child Number1", { selector: "p" })).toBeInTheDocument();
      expect(screen.getByText("Child Number1", { selector: "strong" })).toBeInTheDocument();
    });

    it("names who could not be approved and why, rather than counting them", async () => {
      fetchMock.mockResolvedValue({
        approvedIds: ["occ-0"],
        failed: [
          {
            occasionId: "occ-1",
            recipientName: "Child Number1",
            reason: "Auto-send needs a recipient with a postal address",
          },
        ],
      });
      setup(2);
      await tickAllWithDesign();

      await userEvent.click(screen.getByRole("button", { name: "Approve 2 selected" }));

      await waitFor(() => expect(screen.getByText(/1 could not be approved/)).toBeInTheDocument());
      expect(screen.getByText(/postal address/)).toBeInTheDocument();
      expect(screen.getByText("Child Number1", { selector: "strong" })).toBeInTheDocument();
    });

    it("carries auto-send and its postage class when the plan allows it", async () => {
      fetchMock.mockResolvedValue({ approvedIds: ["occ-0", "occ-1"], failed: [] });
      setup(2, 2, true);
      await tickAllWithDesign();

      await userEvent.click(screen.getByRole("checkbox", { name: /Auto-send them/ }));
      await userEvent.selectOptions(
        screen.getByLabelText("Postage class for the selected cards"),
        "first_class",
      );
      await userEvent.click(screen.getByRole("button", { name: /Approve & auto-send 2/ }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
      expect(JSON.parse(init.body)).toMatchObject({
        dispatchOption: "auto_send",
        postageClass: "first_class",
      });
    });

    it("offers no auto-send option when the plan does not include it", async () => {
      setup(2, 2, false);
      await tickAllWithDesign();

      expect(screen.queryByRole("checkbox", { name: /Auto-send them/ })).not.toBeInTheDocument();
    });
  });

  describe("what an approved auto-send card says about itself", () => {
    it("shows the design it was actually approved with, not a placeholder", async () => {
      // The scheduled list renders designName(occasion.savedDesignId). Pushing
      // the pre-approval object leaves that null, so a card approved with "Well
      // Done" described itself as "your chosen design".
      fetchMock.mockResolvedValue({ approvedIds: ["occ-0", "occ-1"], failed: [] });
      setup(2, 2, true);
      await tickAllWithDesign("d2");
      await userEvent.click(screen.getByRole("checkbox", { name: /Auto-send them/ }));

      await userEvent.click(screen.getByRole("button", { name: /Approve & auto-send 2/ }));

      await waitFor(() => expect(screen.getAllByText(/Auto-send on/).length).toBeGreaterThan(0));
      expect(screen.getAllByText(/Well Done/).length).toBeGreaterThan(0);
      expect(screen.queryByText(/your chosen design/)).not.toBeInTheDocument();
    });

    it("says nothing about when it posts rather than saying the wrong day", async () => {
      // Approving for auto-send re-times the dispatch date to the postage class
      // server-side. The client does not know the new one, and the old one is no
      // longer true — so the "Posts around" line stays away rather than naming a
      // date the card will not go out on.
      fetchMock.mockResolvedValue({ approvedIds: ["occ-0", "occ-1"], failed: [] });
      setup(2, 2, true);
      await tickAllWithDesign();
      await userEvent.click(screen.getByRole("checkbox", { name: /Auto-send them/ }));

      await userEvent.click(screen.getByRole("button", { name: /Approve & auto-send 2/ }));

      await waitFor(() => expect(screen.getAllByText(/Auto-send on/).length).toBeGreaterThan(0));
      expect(screen.queryByText(/Posts around/)).not.toBeInTheDocument();
    });

    it("puts a singly approved auto-send card in the same list as a bulk one", async () => {
      // The two paths disagreed: bulk added the card to "Approved and waiting"
      // and the row-level Approve button did not, so a single auto-send approval
      // vanished from every list on the page until a reload. That is the class
      // review finding 23 was about — advancing a card removing it from views
      // where it belongs.
      fetchMock.mockResolvedValue({});
      setup(1, 1, true);
      await userEvent.selectOptions(within(rowFor(0)).getByRole("combobox"), "d2");
      await userEvent.click(within(rowFor(0)).getByRole("checkbox", { name: /Auto-send/ }));

      await userEvent.click(within(rowFor(0)).getByRole("button", { name: "Approve & auto-send" }));

      await waitFor(() => expect(screen.getAllByText(/Auto-send on/).length).toBeGreaterThan(0));
      expect(screen.getAllByText(/Well Done/).length).toBeGreaterThan(0);
    });

    it("stops naming a failure once that row has left the queue", async () => {
      fetchMock.mockResolvedValue({
        approvedIds: ["occ-0"],
        failed: [{ occasionId: "occ-1", recipientName: "Child Number1", reason: "No address" }],
      });
      setup(2);
      await tickAllWithDesign();
      await userEvent.click(screen.getByRole("button", { name: "Approve 2 selected" }));
      await waitFor(() => expect(screen.getByText(/1 could not be approved/)).toBeInTheDocument());

      // Skipping the offending row takes it out of the queue; the notice must
      // not keep naming somebody who is no longer on the page.
      fetchMock.mockResolvedValue({});
      await userEvent.click(within(rowFor(1)).getByRole("button", { name: "Skip" }));

      await waitFor(() =>
        expect(screen.queryByText(/could not be approved/)).not.toBeInTheDocument(),
      );
    });
  });

  /**
   * The state that lost seven cards on one account: approved, so out of the
   * queue above; not automated, so out of the scheduled list below; drawn on the
   * calendar in the same yellow as a card that was not ready at all. It appeared
   * on no screen, and the nightly sweep retired each one as `missed`.
   * See docs/click-and-forget-capture-recon.md.
   */
  describe("approved but waiting for an order", () => {
    it("names the cards nothing will send", () => {
      setupAwaiting([awaiting("a1", "2026-10-01T00:00:00.000Z")]);

      expect(screen.getByText("Approved, waiting for you to order")).toBeInTheDocument();
      expect(screen.getByText("Ryan Mafukidze")).toBeInTheDocument();
    });

    // A date is not an instruction. The point of the section is that somebody
    // reading it knows which ones are running out without doing the arithmetic.
    it("says how long is left rather than printing a date to work out", () => {
      setupAwaiting([awaiting("a1", "2026-09-28T00:00:00.000Z")]);

      expect(screen.getByText(/Must post in 2 days/)).toBeInTheDocument();
    });

    it("says plainly when the posting date has already gone", () => {
      setupAwaiting([awaiting("a1", "2026-09-24T00:00:00.000Z")]);

      expect(screen.getByText(/Should have posted 2 days ago/)).toBeInTheDocument();
    });

    it("routes each one to the order flow", () => {
      setupAwaiting([awaiting("a1", "2026-10-01T00:00:00.000Z")]);

      expect(screen.getByRole("link", { name: "Order now" })).toHaveAttribute(
        "href",
        "/batch-orders",
      );
    });

    // The section is an alarm. An empty one on every visit is an alarm nobody
    // reads.
    it("stays away when there is nothing waiting", () => {
      setupAwaiting([]);

      expect(screen.queryByText("Approved, waiting for you to order")).not.toBeInTheDocument();
    });

    it("says so when it is showing fewer than there are", () => {
      setupAwaiting([awaiting("a1", "2026-10-01T00:00:00.000Z")], 9);

      expect(screen.getByText(/Showing 1 of 9/)).toBeInTheDocument();
    });

    // "Nothing waiting for approval right now" beside a list of cards nobody is
    // going to send would be the same false reassurance in a new place.
    it("does not read as an empty queue when cards are waiting to be ordered", () => {
      setupAwaiting([awaiting("a1", "2026-09-28T00:00:00.000Z")]);

      expect(screen.getByText("Nothing waiting for approval right now.")).toBeInTheDocument();
      expect(screen.getByText(/Must post in 2 days/)).toBeInTheDocument();
    });
  });

  /**
   * The fix at the point of failure. On an account running click and forget the
   * owner has already said "stop asking me, send these" — but the queue started
   * every toggle off, so approving by hand quietly opted the card out of that
   * instruction, leaving it approved, unpaid, on no screen, and retired as
   * `missed` after the date. See ADR 0271.
   */
  describe("when click and forget is running", () => {
    const autoSendBoxes = () =>
      screen
        .getAllByRole("checkbox")
        .filter((box) =>
          box.closest("label")?.textContent?.includes("we order, pay from your wallet"),
        );

    it("starts each card on auto-send, matching what the account asked for", () => {
      setup(2, 2, true, true);

      for (const box of autoSendBoxes()) expect(box).toBeChecked();
    });

    it("says so, rather than silently ticking a box", () => {
      setup(1, 1, true, true);

      expect(screen.getByText(/Click & forget is running/)).toBeInTheDocument();
    });

    // The default only moves for the account that asked for it.
    it("leaves the toggle off when the instruction is not running", () => {
      setup(2, 2, true, false);

      for (const box of autoSendBoxes()) expect(box).not.toBeChecked();
    });

    it("stays off when the plan does not allow auto-send at all", () => {
      setup(2, 2, false, true);

      expect(autoSendBoxes()).toHaveLength(0);
    });

    it("can still be turned off for one card", async () => {
      const user = userEvent.setup();
      setup(1, 1, true, true);
      const box = autoSendBoxes()[0]!;

      await user.click(box);

      expect(box).not.toBeChecked();
    });
  });

  /**
   * Approving for auto-send is refused server-side when the contact has no
   * postal address, so defaulting the box on there would offer a choice
   * guaranteed to fail on submit.
   */
  describe("a contact with no postal address", () => {
    const addressless = (): OccasionWithRecipient =>
      ({
        id: "occ-no-address",
        type: "birthday",
        occasionDate: "2026-10-03T00:00:00.000Z",
        dispatchDate: "2026-10-01T00:00:00.000Z",
        status: "pending_approval",
        recipient: { id: "r-x", firstName: "No", lastName: "Address" },
      }) as unknown as OccasionWithRecipient;

    function setupAddressless() {
      render(
        <ApprovalsClient
          initialOccasions={[addressless()]}
          totalPending={1}
          initialScheduledSends={[]}
          awaitingOrder={[]}
          totalAwaitingOrder={0}
          todayIso="2026-09-26"
          savedDesigns={[{ id: "d1", name: "Happy Birthday" } as never]}
          autoSendEnabled
          clickAndForgetRunning
        />,
      );
    }

    it("does not tick a box the server would refuse", () => {
      setupAddressless();

      const box = screen
        .getAllByRole("checkbox")
        .find((b) => b.closest("label")?.textContent?.includes("we order, pay from your wallet"));
      expect(box).not.toBeChecked();
    });

    it("says why, instead of leaving an unexplained gap", () => {
      setupAddressless();

      expect(screen.getByText(/No postal address/)).toBeInTheDocument();
    });
  });
});
