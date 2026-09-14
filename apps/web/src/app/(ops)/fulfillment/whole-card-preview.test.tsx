import { render, screen } from "@testing-library/react";
import type { DesignDocument, DesignElement } from "@kudos/shared-types";
import { WholeCardPreview } from "./whole-card-preview";

jest.mock("@/components/card-face-preview", () => ({
  CardFacePreview: ({ face }: { face?: string }) => (
    <div data-testid="face" data-face={face ?? "front"} />
  ),
}));

/**
 * Phase 4 of docs/card-message-guardrails-plan.md: ops can see the whole card.
 *
 * The queue's Preview card showed the front alone and called it "printed
 * exactly as shown". Elise Bisby's front was perfect; the damage was on the
 * inside right. An operator could look straight at the broken card and pass it.
 */
function text(id: string, body: string, y: number): DesignElement {
  return {
    kind: "text",
    id,
    text: body,
    x: 60,
    y,
    fontFamily: "Helvetica",
    fontSize: 18,
    color: "#1a1a1a",
    width: 330,
  } as DesignElement;
}

const card: DesignDocument = {
  version: 1,
  pages: [
    { name: "front", elements: [] },
    { name: "inside-left", elements: [] },
    {
      name: "inside-right",
      elements: [
        text("a", "To Florence,\n\nHappy Birthday!\n\nFrom all at Kip x", 120),
        text("b", "To Elise\n\nHappy Birthday!\n\nFrom all at Kip x", 150),
      ],
    },
    { name: "back", elements: [] },
  ],
} as DesignDocument;

describe("WholeCardPreview", () => {
  it("shows every face of the card, not just the front", async () => {
    render(<WholeCardPreview document={card} />);

    const faces = await screen.findAllByTestId("face");
    expect(faces.map((node) => node.dataset.face)).toEqual([
      "front",
      "inside-left",
      "inside-right",
      "back",
    ]);
  });

  it("reads back the text of the face that is actually wrong", () => {
    render(<WholeCardPreview document={card} />);

    // Both messages, and the overlap called out — the answer to "which message
    // is on here twice?" without leaving the queue.
    expect(screen.getByText(/To Florence,/)).toBeInTheDocument();
    expect(screen.getByText(/To Elise/)).toBeInTheDocument();
    expect(screen.getAllByText(/Overlaps another block on this face/)).toHaveLength(2);
  });

  it("explains the blank strip on the back rather than leaving it to look like a fault", () => {
    render(<WholeCardPreview document={card} />);

    expect(
      screen.getByText(/already has the Kudos logo and QR code printed there/),
    ).toBeInTheDocument();
  });

  it("renders only the faces a design actually has", async () => {
    const frontOnly = { version: 1, pages: [{ name: "front", elements: [] }] } as DesignDocument;
    render(<WholeCardPreview document={frontOnly} />);

    expect(await screen.findAllByTestId("face")).toHaveLength(1);
    expect(screen.queryByText(/already has the Kudos logo/)).not.toBeInTheDocument();
  });
});
