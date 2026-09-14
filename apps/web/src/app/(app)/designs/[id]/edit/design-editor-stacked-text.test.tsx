import { useEffect } from "react";
import { render, screen, waitFor } from "@testing-library/react";
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
 * what is under test here is whether the editor says anything when it does.
 *
 * The measurement rule itself is tested as `overlapFraction`, which the canvas
 * and the pre-send check share.
 */
let reportPairs = 0;
jest.mock("./design-canvas", () => ({
  DesignCanvas: ({ onStackedTextChange }: { onStackedTextChange?: (pairs: number) => void }) => {
    useEffect(() => {
      onStackedTextChange?.(reportPairs);
    }, [onStackedTextChange]);
    return <div data-testid="canvas" />;
  },
}));

const design = {
  id: "d-1",
  name: "Happy Tulips copy",
  document: {
    pages: [
      { name: "front", elements: [] },
      { name: "inside-left", elements: [] },
      { name: "inside-right", elements: [] },
      { name: "back", elements: [] },
    ],
  },
} as unknown as SavedDesign;

describe("DesignEditorClient — text written on top of text", () => {
  it("says so, and says what to do about it", async () => {
    // Elise Bisby's card carried two messages — hers and Florence's — because a
    // new message was written beside the old one rather than over it. The editor
    // is the one place where fixing that costs nothing.
    reportPairs = 1;
    render(
      <DesignEditorClient savedDesign={design} messagePages={[]} canAuthorMessagePages={false} />,
    );

    expect(
      await screen.findByText(/Two pieces of text on this face are written on top of each other/),
    ).toBeInTheDocument();
    expect(screen.getByText(/If one of them is an older message, delete it/)).toBeInTheDocument();
  });

  it("stays quiet when nothing overlaps", async () => {
    // The discriminator. A banner on every design is one people stop reading,
    // which costs exactly as much as never showing it.
    //
    // The canvas arrives through next/dynamic, so it must be waited for before
    // the absence means anything: asserted too early this passes on a page that
    // never rendered the canvas at all, and would keep passing with the whole
    // feature deleted.
    reportPairs = 0;
    render(
      <DesignEditorClient savedDesign={design} messagePages={[]} canAuthorMessagePages={false} />,
    );
    await waitFor(() => expect(screen.getByTestId("canvas")).toBeInTheDocument());

    expect(screen.queryByText(/written on top of each other/)).not.toBeInTheDocument();
  });
});
