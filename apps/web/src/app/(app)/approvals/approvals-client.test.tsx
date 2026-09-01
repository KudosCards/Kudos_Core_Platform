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
      recipient: { id: `r-${i}`, firstName: "Child", lastName: `Number${i}` },
    }) as unknown as OccasionWithRecipient;

  function setup(count = 3, totalPending = count, autoSendEnabled = false) {
    const occasions = Array.from({ length: count }, (_, i) => person(i));
    render(
      <ApprovalsClient
        initialOccasions={occasions}
        totalPending={totalPending}
        initialScheduledSends={[]}
        savedDesigns={[
          { id: "d1", name: "Happy Birthday" } as never,
          { id: "d2", name: "Well Done" } as never,
        ]}
        autoSendEnabled={autoSendEnabled}
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
});
