import { render, screen, within } from "@testing-library/react";
import type { DesignDocument, DesignElement } from "@kudos/shared-types";
import { CardTextReadout } from "./card-text-readout";

/**
 * The view that would have answered the Elise Bisby question in seconds.
 *
 * A super admin saw two messages overlapping on a card and had no way to find
 * out what it carried except by reading the render — which is exactly the thing
 * that had gone wrong. Diagnosing it took a screenshot and a trace through the
 * code. See docs/card-content-preflight-plan.md.
 */

function text(over: Partial<Extract<DesignElement, { kind: "text" }>>): DesignElement {
  return {
    kind: "text",
    id: "t",
    text: "Hello",
    x: 60,
    y: 120,
    fontFamily: "Helvetica",
    fontSize: 18,
    color: "#1a1a1a",
    width: 330,
    ...over,
  };
}

const doc = (elements: DesignElement[]): DesignDocument => ({
  version: 1,
  pages: [
    { name: "front", elements: [] },
    { name: "inside-left", elements: [] },
    { name: "inside-right", elements },
    { name: "back", elements: [] },
  ],
});

const ELISE =
  "To Elise\n\nHappy Birthday!\n\nWe hope you have a fantastic day,\n\nFrom all of your friends at Kip x";
const FLORENCE =
  "To Florence,\n\nHappy Birthday!\n\nHave a lovely day,\n\nFrom all of your friends at Kip x";

describe("CardTextReadout", () => {
  it("reads back both messages, and marks the ones that overlap", () => {
    const document = doc([
      text({ id: "elise", text: ELISE, y: 120 }),
      text({ id: "florence", text: FLORENCE, y: 150 }),
    ]);

    render(<CardTextReadout document={document} face="inside-right" />);

    expect(screen.getByText(/To Elise/)).toBeInTheDocument();
    expect(screen.getByText(/To Florence,/)).toBeInTheDocument();
    expect(screen.getByText(/2 text blocks/)).toBeInTheDocument();
    expect(screen.getByText(/1 overlapping pair/)).toBeInTheDocument();
    // Both sides of the pair are marked, not just the one drawn second.
    expect(screen.getAllByText(/Overlaps another block on this face/)).toHaveLength(2);
  });

  it("opens itself when something overlaps, and stays shut when nothing does", () => {
    const clashing = doc([
      text({ id: "elise", text: ELISE, y: 120 }),
      text({ id: "florence", text: FLORENCE, y: 150 }),
    ]);
    const { container: open } = render(<CardTextReadout document={clashing} face="inside-right" />);
    expect(open.querySelector("details")).toHaveAttribute("open");

    // An operator working through a print run does not want every card's text
    // unfolded at them, and a panel that is always open is one nobody reads.
    const fine = doc([
      text({ id: "one", text: "Happy Birthday!", y: 40 }),
      text({ id: "two", text: "From all at Kip x", y: 500 }),
    ]);
    const { container: shut } = render(<CardTextReadout document={fine} face="inside-right" />);
    expect(shut.querySelector("details")).not.toHaveAttribute("open");
    // Scoped to this render: both components share one document body, and an
    // unscoped query finds the clashing card's badge above.
    expect(within(shut).queryByText(/overlapping/)).not.toBeInTheDocument();
  });

  it("shows the text of the face it was asked for, not another one", () => {
    const document = doc([text({ id: "inside", text: "Inside message" })]);
    document.pages[0]!.elements = [text({ id: "front", text: "Front message" })];

    render(<CardTextReadout document={document} face="front" />);

    expect(screen.getByText("Front message")).toBeInTheDocument();
    expect(screen.queryByText("Inside message")).not.toBeInTheDocument();
  });

  it("says nothing at all about a face with no text", () => {
    const { container } = render(<CardTextReadout document={doc([])} face="inside-right" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("ignores an empty text box rather than listing a blank block", () => {
    // Easy to leave behind in the editor, and listing it would make the count
    // wrong in the one place an operator is counting.
    const document = doc([
      text({ id: "real", text: "Happy Birthday!" }),
      text({ id: "blank", text: "   " }),
    ]);

    render(<CardTextReadout document={document} face="inside-right" />);

    expect(screen.getByText(/1 text block/)).toBeInTheDocument();
  });

  it("keeps the line breaks the card has", () => {
    // A message reflowed to the panel's width is a different message to read.
    const document = doc([text({ id: "m", text: "Line one\nLine two" })]);

    const { container } = render(<CardTextReadout document={document} face="inside-right" />);

    expect(container.querySelector("p")).toHaveClass("whitespace-pre-wrap");
  });
});
