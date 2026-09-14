import { render, screen } from "@testing-library/react";
import type { BatchOrderPreflight } from "@kudos/shared-types";
import { PreSendCheck } from "./pre-send-check";

/**
 * The two warnings that would have caught the cards this work exists for.
 *
 * Elise Bisby's card carried two messages stacked on one face — hers and
 * Florence's. Cole Fortes's card was addressed by hand to "alex". The pre-send
 * check knew about missing addresses, bad postcodes, unresolved tokens and
 * recent duplicates, and said nothing about either. See
 * docs/card-content-preflight-plan.md.
 */

const clean: BatchOrderPreflight = {
  total: 7,
  ready: 7,
  missingAddress: { count: 0, sample: [] },
  invalidPostcode: { count: 0, sample: [] },
  unresolvedTokens: { count: 0, sample: [] },
  duplicate: { count: 0, sample: [] },
  price: {
    cardCount: 7,
    cardSubtotalMinor: 0,
    discountMinor: 0,
    vatMinor: 0,
    vatRatePercent: 20,
    postageMinor: 0,
    totalMinor: 0,
  },
  occasionDated: { count: 0, earliest: null, latest: null, skipped: 0 },
  backArtworkClipped: { background: false, elements: 0 },
  stackedText: [],
  namedByHand: [],
};

function renderCheck(
  preflight: BatchOrderPreflight,
  acknowledged: { names?: string[]; onAcknowledgeName?: (name: string, ok: boolean) => void } = {},
) {
  return render(
    <PreSendCheck
      preflight={preflight}
      busy={false}
      error={null}
      editDesignHref="/designs/abc/edit"
      onFixAddress={() => {}}
      acknowledgedNames={acknowledged.names ?? []}
      onAcknowledgeName={acknowledged.onAcknowledgeName ?? (() => {})}
    />,
  );
}

describe("PreSendCheck content warnings", () => {
  it("says two pieces of text overlap, and where", () => {
    renderCheck({ ...clean, stackedText: [{ face: "inside-right", pairs: 1 }] });

    expect(screen.getByText(/Two pieces of text overlap on the inside right/)).toBeInTheDocument();
    // The likely cause, said plainly — this is almost always an old message left
    // behind rather than a deliberate layout.
    expect(screen.getByText(/an old message was left behind/)).toBeInTheDocument();
  });

  it("names the person the design addresses, and how many cards are not theirs", () => {
    renderCheck({
      ...clean,
      namedByHand: [{ name: "alex", face: "inside-right", wrongFor: 7, mustAcknowledge: true }],
    });

    expect(screen.getByText(/This design says “alex” on the inside right/)).toBeInTheDocument();
    expect(screen.getByText(/7 of 7 cards are going to somebody else/)).toBeInTheDocument();
  });

  it("reads correctly for a single card", () => {
    // "1 of 1 cards are" is the sort of thing that makes a warning look
    // automated and therefore ignorable.
    renderCheck({
      ...clean,
      total: 1,
      namedByHand: [{ name: "Florence", face: "front", wrongFor: 1, mustAcknowledge: true }],
    });

    expect(screen.getByText(/1 of 1 card is going to somebody else/)).toBeInTheDocument();
  });

  it("does not claim a card is wrong when everyone in the send has that name", () => {
    renderCheck({
      ...clean,
      namedByHand: [{ name: "Elise", face: "inside-right", wrongFor: 0, mustAcknowledge: false }],
    });

    expect(screen.getByText(/Everyone in this send has that name/)).toBeInTheDocument();
  });

  it("asks the sender to confirm a greeting that is wrong for somebody", () => {
    // The gap this closes: the warning above has always been there, and a
    // warning can be clicked past. See docs/card-message-guardrails-plan.md.
    const onAcknowledgeName = jest.fn();
    renderCheck(
      {
        ...clean,
        total: 1,
        namedByHand: [{ name: "Florence", face: "front", wrongFor: 1, mustAcknowledge: true }],
      },
      { onAcknowledgeName },
    );

    const confirm = screen.getByRole("checkbox");
    expect(confirm).not.toBeChecked();
    confirm.click();
    // Reported by name, because that is what the server matches on — a bare
    // "yes" would be a one-time dismissal that survives an edit.
    expect(onAcknowledgeName).toHaveBeenCalledWith("Florence", true);
  });

  it("shows the confirmation as already given, however it was typed back", () => {
    renderCheck(
      {
        ...clean,
        namedByHand: [{ name: "Florence", face: "front", wrongFor: 7, mustAcknowledge: true }],
      },
      { names: ["florence"] },
    );

    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("asks for nothing on a name that only warns", () => {
    // A card to Joy that says "wishing you joy" is not a mistake, so it keeps
    // its warning and never stands in the way of the send.
    renderCheck({
      ...clean,
      namedByHand: [{ name: "Joy", face: "inside-right", wrongFor: 6, mustAcknowledge: false }],
    });

    expect(screen.getByText(/This design says “Joy” on the inside right/)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("stays silent on a design with nothing wrong", () => {
    // The discriminator. A banner on every good send is one people learn to
    // scroll past, which costs exactly as much as never showing it.
    renderCheck(clean);

    expect(screen.queryByText(/Two pieces of text overlap/)).not.toBeInTheDocument();
    expect(screen.queryByText(/This design says/)).not.toBeInTheDocument();
  });
});
