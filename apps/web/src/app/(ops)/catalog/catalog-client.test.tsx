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

  it("names each one, worst first, with how much is lost", async () => {
    await syncReturning({
      cropped: [
        {
          externalId: "rec-wide",
          sku: "KC-PAN-001",
          title: "Panorama",
          percent: 53,
          axis: "width",
          verdict: "heavy",
        },
        {
          externalId: "rec-34",
          sku: null,
          title: "Gentle Stripes",
          percent: 5,
          axis: "width",
          verdict: "noticeable",
        },
      ],
    });

    expect(screen.getByText(/53% of the width/)).toBeInTheDocument();
    expect(screen.getByText(/Panorama/)).toBeInTheDocument();
    expect(screen.getByText(/5% of the width/)).toBeInTheDocument();
    // And the number in the tallies, so the size of the problem is visible
    // without reading the list.
    expect(screen.getByText("Artwork being cropped: 2")).toBeInTheDocument();
    // Say what to do about it, or the list is just bad news.
    expect(screen.getByText(/1050 × 1480/)).toBeInTheDocument();
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
