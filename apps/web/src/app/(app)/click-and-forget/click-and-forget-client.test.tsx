import type { StandingOrder } from "@kudos/shared-types";
import { render, screen } from "@testing-library/react";
import { ClickAndForgetClient } from "./click-and-forget-client";

/**
 * The page that switches automatic sending on.
 *
 * Three things here are worth guarding, and all three are about not promising
 * something the product does not yet do: the message pool is saved but not
 * printed, a smart-list audience is refused rather than quietly obeyed, and an
 * instruction that is switched on but stopped must say so rather than showing a
 * reassuring green tick.
 */

const STATEMENT = [
  "You are asking Kudos to send cards for you without checking with you first.",
  "Each card is paid for from your wallet balance at the time it is sent.",
];

function order(over: Partial<StandingOrder> = {}): StandingOrder {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    enabled: false,
    audience: { kind: "all" },
    postageClass: "second_class",
    designs: [],
    messages: [],
    active: false,
    blockers: [],
    consent: null,
    consentStatement: STATEMENT,
    consentVersion: 1,
    planAllows: true,
    ...over,
  };
}

function renderPage(
  over: Partial<StandingOrder> = {},
  lists: { id: string; name: string; memberCount: number }[] = [],
) {
  render(
    <ClickAndForgetClient
      initialOrder={order(over)}
      designs={[{ id: "d1", name: "Balloons" }]}
      lists={lists}
    />,
  );
}

describe("Click and forget", () => {
  it("names the cards that will not use the messages", () => {
    // A subscriber who wrote five messages deserves to know which of their
    // cards will not use them, by name — "two of your cards" is not actionable.
    renderPage({
      designs: [
        { savedDesignId: "d1", name: "Balloons", archived: false, takesMessage: true },
        { savedDesignId: "d2", name: "Hand-built card", archived: false, takesMessage: false },
      ],
    });
    expect(screen.getByText(/One of your cards will not use these/i)).toBeInTheDocument();
    expect(screen.getByText(/Hand-built card/)).toBeInTheDocument();
  });

  it("says nothing about it when every card takes a message", () => {
    renderPage({
      designs: [{ savedDesignId: "d1", name: "Balloons", archived: false, takesMessage: true }],
    });
    expect(screen.queryByText(/will not use these/i)).not.toBeInTheDocument();
  });

  it("does not claim to be running when something is stopping it", () => {
    renderPage({ enabled: true, active: false, blockers: ["empty_pool", "consent"] });
    expect(screen.getByText(/Switched on, but not running yet/i)).toBeInTheDocument();
    expect(screen.getByText(/at least one card design and one message/i)).toBeInTheDocument();
    expect(screen.getByText(/Nobody has agreed to how this works/i)).toBeInTheDocument();
    expect(screen.queryByText(/We are sending these cards for you/i)).not.toBeInTheDocument();
  });

  it("says it is running only when it actually is", () => {
    renderPage({ enabled: true, active: true });
    expect(screen.getByText(/We are sending these cards for you/i)).toBeInTheDocument();
  });

  it("tells a Free account what it is looking at, without hiding any of it", () => {
    renderPage({ planAllows: false });
    // Said twice on purpose — once at the top, once beside the switch that is
    // disabled because of it — so the assertion names both rather than tripping
    // over the second.
    expect(screen.getAllByText(/on Pro and above/i)).toHaveLength(2);
    expect(screen.getByRole("link", { name: /See plans/i })).toBeInTheDocument();
    // The whole thing is still laid out — the point is that the upgrade prompt
    // reaches somebody who has already chosen their cards.
    expect(screen.getByRole("button", { name: "Balloons" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Send these cards for me/i })).toBeDisabled();
  });

  it("will not let anybody switch it on before they have agreed", () => {
    renderPage();
    expect(screen.getByRole("checkbox", { name: /Send these cards for me/i })).toBeDisabled();
    expect(screen.getByText(/Tick the box above first/i)).toBeInTheDocument();
  });

  it("refuses a smart-list audience out loud", () => {
    renderPage({
      audience: { kind: "segment", segmentId: "22222222-2222-4222-8222-222222222222" },
      enabled: true,
      blockers: ["audience_unsupported"],
    });
    // Two places: the banner explaining why nothing is happening, and the
    // audience section where they fix it.
    expect(screen.getAllByText(/Smart lists change on their own/i).length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.getByText(/currently pointed at a smart list/i)).toBeInTheDocument();
  });

  it("does not offer a list when the account has none", () => {
    renderPage();
    expect(screen.getByRole("radio", { name: /One of my lists/i })).toBeDisabled();
    expect(screen.getByText(/no lists yet/i)).toBeInTheDocument();
  });

  it("offers the account's lists with their sizes", () => {
    renderPage({ audience: { kind: "list", listId: "l1" } }, [
      { id: "l1", name: "Year 4 class", memberCount: 28 },
    ]);
    expect(screen.getByRole("radio", { name: /One of my lists/i })).not.toBeDisabled();
    expect(screen.getByRole("option", { name: "Year 4 class (28)" })).toBeInTheDocument();
  });

  it("shows the wording somebody is agreeing to, rather than a bare tickbox", () => {
    renderPage();
    for (const line of STATEMENT) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
  });

  it("asks again when the wording has changed since they agreed", () => {
    renderPage({ consent: { consentedAt: new Date(), version: 0, current: false } });
    expect(screen.getByText(/agreed to an earlier version/i)).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /I have read this and I agree/i }),
    ).not.toBeChecked();
  });

  it("points somebody with no designs at making one", () => {
    render(<ClickAndForgetClient initialOrder={order()} designs={[]} lists={[]} />);
    expect(screen.getByRole("link", { name: /Make one first/i })).toBeInTheDocument();
  });
});
