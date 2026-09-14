import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiError } from "@/lib/api";
import { OpsRoleProvider } from "../ops-role";
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
    // together. Scoped to the cropped section: the crop-gate panel names the
    // same size, so a bare matcher finds two.
    expect(screen.getByText(/re-attach in Airtable/)).toHaveTextContent(/1240 × 1748/);
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

/**
 * The refusal, and the reason it is a switch rather than a rule.
 *
 * Closing it today would reject 207 of 217 designs and empty the library. It
 * exists so that the day the catalog is re-exported, ops can close it and the
 * problem cannot come back — with no window in between where the gate is on and
 * the artwork is not ready. See docs/card-artwork-shape-plan.md, Phase 5.
 */
describe("CatalogClient — the crop gate", () => {
  afterEach(() => clientApiFetch.mockReset());

  it("starts from whatever the server says, and says which way round it is", () => {
    render(<CatalogClient configured cropGateEnabled />);
    expect(screen.getByLabelText(/cropped artwork is refused/)).toBeChecked();
  });

  it("is off when the API has not been asked, or has no answer", () => {
    // An API that predates the gate is the same thing as the gate being open,
    // and the page must not imply a protection that is not there.
    render(<CatalogClient configured />);
    expect(screen.getByLabelText(/cropped artwork is imported/)).not.toBeChecked();
  });

  it("warns against closing it before the catalog is ready", () => {
    render(<CatalogClient configured />);
    expect(screen.getByText(/turn away almost the whole catalog/)).toBeInTheDocument();
  });

  /** The panel is readable by any operator and changeable only by a super
   *  admin, so a test that means to click has to say who is clicking. */
  const asSuperAdmin = () =>
    render(
      <OpsRoleProvider role="super_admin">
        <CatalogClient configured />
      </OpsRoleProvider>,
    );

  it("lets an ops operator read the setting without changing it", () => {
    // Emptying the shop is a decision about the business, not a routine ops
    // action — but seeing how the catalog is configured is an operator's job.
    render(<CatalogClient configured />);

    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByText(/Super admins only/)).toBeInTheDocument();
  });

  it("stores the change", async () => {
    clientApiFetch.mockResolvedValue({ enabled: true });
    asSuperAdmin();

    await userEvent.click(screen.getByRole("checkbox"));

    expect(clientApiFetch).toHaveBeenCalledWith("/catalog/crop-gate", {
      method: "PUT",
      body: JSON.stringify({ enabled: true }),
    });
    expect(await screen.findByLabelText(/cropped artwork is refused/)).toBeChecked();
  });

  it("puts the switch back if the server refuses", async () => {
    // A toggle left showing "on" after a failed write is the worst outcome
    // here: it claims a protection the catalog does not have.
    clientApiFetch.mockRejectedValue(new ApiError("Nope", 403, null));
    asSuperAdmin();

    await userEvent.click(screen.getByRole("checkbox"));

    expect(await screen.findByLabelText(/cropped artwork is imported/)).not.toBeChecked();
  });
});

/**
 * What the catalog *data* can be wrong about, as opposed to its artwork.
 *
 * None of it corrupts anything — all three are fixed in Airtable — which is
 * exactly why none of it was visible until the sync started saying so.
 */
describe("CatalogClient — the catalog's own data", () => {
  afterEach(() => clientApiFetch.mockReset());

  it("names the cards sharing one product code", async () => {
    await syncReturning({
      duplicateSkus: [
        {
          sku: "KC-INSPIRATIONAL-GEN-011",
          designs: [
            { externalId: "a", title: "Lewis Carroll" },
            { externalId: "b", title: "Henry Fielding Habits" },
          ],
        },
      ],
    });

    expect(screen.getByText(/KC-INSPIRATIONAL-GEN-011/)).toBeInTheDocument();
    expect(screen.getByText(/Lewis Carroll, Henry Fielding Habits/)).toBeInTheDocument();
    expect(screen.getByText("Shared product codes: 1")).toBeInTheDocument();
  });

  it("explains that a name clash is permanent", async () => {
    // The reason this one is worth acting on before publishing rather than
    // after: the slug is assigned once and never recalculated.
    await syncReturning({
      duplicateNames: [
        {
          slug: "well-done-flowers",
          designs: [
            { externalId: "a", title: "Well Done - Flowers" },
            { externalId: "b", title: "Well Done — Flowers" },
          ],
        },
      ],
    });

    expect(screen.getByText("/well-done-flowers")).toBeInTheDocument();
    expect(screen.getByText(/assigned once, never recalculated/)).toBeInTheDocument();
    expect(screen.getByText("Clashing card names: 1")).toBeInTheDocument();
  });

  it("frames a missing category page as a decision, not a fault", async () => {
    // These cards are fine. Reporting them as broken would send somebody
    // hunting for a defect that is not there.
    await syncReturning({ unpublishedCategories: [{ category: "christmas", count: 12 }] });

    const heading = screen.getByText("Categories with no landing page");
    expect(heading).toBeInTheDocument();
    expect(heading.className).not.toContain("amber");
    expect(screen.getByText(/12 cards/)).toBeInTheDocument();
    expect(screen.getByText(/they sync, they browse/)).toBeInTheDocument();
  });

  it("says nothing at all when the catalog is in good order", async () => {
    // Three sections that appear on every sync are three sections nobody reads.
    await syncReturning({ duplicateSkus: [], duplicateNames: [], unpublishedCategories: [] });

    expect(screen.queryByText(/more than one card/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Two cards, one address/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Categories with no landing page/)).not.toBeInTheDocument();
  });

  it("survives a summary from an API that has not been deployed yet", async () => {
    await syncReturning({});

    expect(screen.getByText("Shared product codes: 0")).toBeInTheDocument();
    expect(screen.queryByText(/Two cards, one address/)).not.toBeInTheDocument();
  });
});
