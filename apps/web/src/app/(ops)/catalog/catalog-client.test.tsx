import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CatalogClient } from "./catalog-client";

const clientApiFetch = jest.fn();
jest.mock("@/lib/api.client", () => ({
  clientApiFetch: (...args: unknown[]) => clientApiFetch(...args),
}));

/**
 * The ops catalog panel, which had no tests.
 *
 * "Which of our designs are being cut up" had no answer anywhere: a background
 * fills the card edge to edge, centred and cropped to 1:1.409, and nothing
 * measured what that discarded. The sync measures it now — this is where the
 * answer has to actually appear. See docs/card-artwork-crop-plan.md.
 */

const EMPTY_SUMMARY = {
  fetched: 4,
  created: 0,
  updated: 4,
  deactivated: 0,
  imagesCopied: 4,
  skippedNoImage: [],
  artworkFailed: [],
  errors: [],
};

async function syncReturning(summary: Record<string, unknown>) {
  clientApiFetch.mockResolvedValue({ ...EMPTY_SUMMARY, ...summary });
  render(<CatalogClient configured />);
  await userEvent.click(screen.getByRole("button", { name: /Refresh catalog/ }));
  return screen.findByText("Sync complete");
}

describe("CatalogClient — designs whose artwork is being cut up", () => {
  afterEach(() => clientApiFetch.mockReset());

  const design = (over: Partial<Record<string, unknown>>) => ({
    externalId: "rec-1",
    sku: null,
    title: "Untitled",
    percent: 6,
    axis: "height",
    verdict: "noticeable",
    width: 1000,
    height: 1500,
    ...over,
  });

  it("names a handful individually, with how much is lost", async () => {
    await syncReturning({
      cropped: [
        design({
          externalId: "rec-wide",
          sku: "KC-PAN-001",
          title: "Panorama",
          percent: 53,
          axis: "width",
          verdict: "heavy",
          width: 1500,
          height: 1000,
        }),
        design({
          externalId: "rec-34",
          title: "Gentle Stripes",
          percent: 5,
          axis: "width",
          width: 1000,
          height: 1333,
        }),
      ],
    });

    expect(screen.getByText(/1 design loses 53% of its width/)).toBeInTheDocument();
    expect(screen.getByText(/Panorama/)).toBeInTheDocument();
    expect(screen.getByText(/1 design loses 5% of its width/)).toBeInTheDocument();
    expect(screen.getByText("Artwork being cropped: 2")).toBeInTheDocument();
    // Say what to do about it, or the list is just bad news. 1240 x 1748 is A6
    // at 300dpi — the one export that clears the crop and the resolution check
    // together.
    expect(screen.getByText(/1240 × 1748/)).toBeInTheDocument();
  });

  it("collapses a whole catalog losing the same amount into one line", async () => {
    // The real first sync: 207 designs at an identical 6% of the height. That is
    // one wrong export preset applied 207 times, and printing it 207 times says
    // the opposite — a wall nobody reads, which costs as much as saying nothing.
    const many = Array.from({ length: 207 }, (_, i) =>
      design({ externalId: `rec-${i}`, title: `Design ${i}` }),
    );
    await syncReturning({ cropped: many });

    expect(screen.getByText(/207 designs lose 6% of their height/)).toBeInTheDocument();
    // The source shape travels with the group, so the re-export brief reads
    // straight off the screen.
    expect(screen.getByText(/artwork is 1000 × 1500/)).toBeInTheDocument();
    // And not one line per design.
    expect(screen.queryByText("Design 0")).not.toBeInTheDocument();
    expect(screen.queryByText("Design 206")).not.toBeInTheDocument();
  });

  it("does not claim a source shape a group does not share", async () => {
    // Several sizes can round to the same percentage. Naming one of them as
    // "the" shape would be a confident wrong answer in a re-export brief.
    await syncReturning({
      cropped: [
        design({ externalId: "a", title: "A", width: 1000, height: 1500 }),
        design({ externalId: "b", title: "B", width: 2000, height: 2990 }),
      ],
    });

    expect(screen.getByText(/2 designs lose 6% of their height/)).toBeInTheDocument();
    // Matched on a size, not the bare words — the intro paragraph above already
    // contains "part of the artwork is cut off".
    expect(screen.queryByText(/artwork is \d+ ×/)).not.toBeInTheDocument();
  });

  it("says nothing when every design is the right shape", async () => {
    // The discriminator. A section that appears on every sync is one an
    // operator scrolls past, which costs as much as never showing it.
    await syncReturning({ cropped: [] });

    expect(screen.getByText("Artwork being cropped: 0")).toBeInTheDocument();
    expect(screen.queryByText(/part of the artwork is cut off/)).not.toBeInTheDocument();
  });

  it("survives a summary from an API that has not been deployed yet", async () => {
    // The web app and the API deploy separately, so this panel will meet a
    // summary with no `cropped` field at all. It has to render, not throw.
    await syncReturning({});

    expect(screen.getByText("Artwork being cropped: 0")).toBeInTheDocument();
    expect(screen.queryByText(/part of the artwork is cut off/)).not.toBeInTheDocument();
  });
});
