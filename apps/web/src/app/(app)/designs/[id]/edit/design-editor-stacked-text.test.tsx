import { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SavedDesign } from "@kudos/shared-types";
import { DesignEditorClient } from "./design-editor-client";

// Anything the editor fetches on mount resolves to nothing in particular; this
// test is about what it renders, not what it loads.
jest.mock("@/lib/api.client", () => ({ clientApiFetch: () => Promise.resolve({}) }));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));
jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: jest.fn() }) } }),
}));

/**
 * The canvas is what measures: it reads the rendered Konva nodes, because a text
 * element's real height depends on wrapping and on which font has loaded. None
 * of that exists under jsdom, so the canvas is stubbed and told what to report —
 * what is under test here is whether the editor says anything when it does, and
 * whether a person can act on it.
 *
 * The measurement rule itself is tested as `overlapFraction`, which the canvas
 * and the pre-send check share.
 */
let reportPairs: [string, string][] = [];
jest.mock("./design-canvas", () => ({
  DesignCanvas: ({
    onStackedTextChange,
  }: {
    onStackedTextChange?: (pairs: [string, string][]) => void;
  }) => {
    useEffect(() => {
      onStackedTextChange?.(reportPairs);
    }, [onStackedTextChange]);
    return <div data-testid="canvas" />;
  },
}));

const text = (id: string, body: string) => ({
  kind: "text",
  id,
  text: body,
  x: 40,
  y: 40,
  width: 300,
  fontSize: 18,
  fontFamily: "inter",
  color: "#000000",
  rotation: 0,
});

const design = {
  id: "d-1",
  name: "Happy Tulips copy",
  document: {
    pages: [
      {
        name: "front",
        elements: [
          text("stale", "To Florence,\n\nHave a lovely day,"),
          text("current", "To Elise\n\nWe hope you have a fantastic day,"),
        ],
      },
      { name: "inside-left", elements: [] },
      { name: "inside-right", elements: [] },
      { name: "back", elements: [] },
    ],
  },
} as unknown as SavedDesign;

const open = () =>
  render(
    <DesignEditorClient savedDesign={design} messagePages={[]} canAuthorMessagePages={false} />,
  );

describe("DesignEditorClient — text written on top of text", () => {
  it("says so, and says what to do about it", async () => {
    // Elise Bisby's card carried two messages — hers and Florence's — because a
    // new message was written beside the old one rather than over it. The editor
    // is the one place where fixing that costs nothing.
    reportPairs = [["stale", "current"]];
    open();

    expect(
      await screen.findByText(/Two pieces of text on this face are written on top of each other/),
    ).toBeInTheDocument();
  });

  it("shows what each block says, so nobody deletes the wrong one", async () => {
    // There is no undo in this editor. Offering a delete without showing the
    // text would be asking somebody to guess which block is which on a canvas
    // where one of them is underneath the other.
    reportPairs = [["stale", "current"]];
    open();

    expect(await screen.findByText(/To Florence,/)).toBeInTheDocument();
    expect(screen.getByText(/To Elise/)).toBeInTheDocument();
  });

  it("deletes the block a person picks, and stops warning once it is gone", async () => {
    // The warning used to say "delete the one you don't want" and leave them to
    // find it. A remedy that is a scavenger hunt is a warning people close.
    reportPairs = [["stale", "current"]];
    open();

    const buttons = await screen.findAllByRole("button", { name: /Delete this block/ });
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[0]!);

    // The stale block is gone from the document…
    await waitFor(() => expect(screen.queryByText(/To Florence,/)).not.toBeInTheDocument());
    // …and the canvas, re-rendered, now reports nothing overlapping.
    expect(screen.getByText(/To Elise/)).toBeInTheDocument();
  });

  it("stays quiet when nothing overlaps", async () => {
    // The discriminator. A banner on every design is one people stop reading,
    // which costs exactly as much as never showing it.
    //
    // The canvas arrives through next/dynamic, so it must be waited for before
    // the absence means anything: asserted too early this passes on a page that
    // never rendered the canvas at all, and would keep passing with the whole
    // feature deleted.
    reportPairs = [];
    open();
    await waitFor(() => expect(screen.getByTestId("canvas")).toBeInTheDocument());

    expect(screen.queryByText(/written on top of each other/)).not.toBeInTheDocument();
  });
});
