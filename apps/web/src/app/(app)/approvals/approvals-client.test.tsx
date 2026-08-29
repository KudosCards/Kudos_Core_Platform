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
      status: "pending_approval",
      recipient: { id: `r-${i}`, firstName: "Child", lastName: `Number${i}` },
    }) as unknown as OccasionWithRecipient;

  function setup(count = 3, totalPending = count) {
    const occasions = Array.from({ length: count }, (_, i) => person(i));
    render(
      <ApprovalsClient
        initialOccasions={occasions}
        totalPending={totalPending}
        initialScheduledSends={[]}
        savedDesigns={[{ id: "d1", name: "Happy Birthday" } as never]}
        autoSendEnabled={false}
      />,
    );
    return { occasions };
  }

  beforeEach(() => fetchMock.mockReset());

  const rowFor = (i: number) =>
    screen.getByText(`Child Number${i}`).closest(".card") as HTMLElement;

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
});
