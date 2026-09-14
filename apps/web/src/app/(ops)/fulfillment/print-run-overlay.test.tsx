import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fittedCardInsetMm, type DesignDocument } from "@kudos/shared-types";
import { PrintRunOverlay, type PrintRunCard } from "./print-run-overlay";

jest.mock("@/lib/api.client", () => ({ clientApiDownload: jest.fn() }));
// Konva does not render under jsdom, and none of these assertions are about the
// picture — they are about what the overlay says beside it.
jest.mock("@/components/card-face-preview", () => ({
  CardFacePreview: () => <div data-testid="face" />,
}));

/**
 * The ops print surface, which had no tests at all.
 *
 * A super admin opened a card here and said the artwork looked cut off at the
 * edges. It was — a background is centre-cropped to the card's proportion — and
 * this screen, the last one before a card goes to a printer, said nothing. It
 * reported images too *soft* to print and stayed silent while a third of one was
 * discarded. See docs/card-artwork-crop-plan.md.
 */

/** Stand in for the browser's image loader, so a test can choose what shape the
 *  artwork is. `loadNaturalSize` only ever reads naturalWidth/Height. */
function stubImageLoader(size: { width: number; height: number } | null) {
  class StubImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = size?.width ?? 0;
    naturalHeight = size?.height ?? 0;
    set src(_value: string) {
      // Asynchronous, like a real load, so the effect's await actually awaits.
      setTimeout(() => (size ? this.onload?.() : this.onerror?.()), 0);
    }
  }
  (window as unknown as { Image: unknown }).Image = StubImage;
}

const BACKGROUND = "https://x.supabase.co/storage/v1/object/public/design-assets/acc/front.png";

const document_: DesignDocument = {
  version: 1,
  pages: [
    { name: "front", elements: [], background: { type: "image", assetUrl: BACKGROUND } },
    { name: "inside-left", elements: [] },
    { name: "inside-right", elements: [] },
    { name: "back", elements: [] },
  ],
};

const card: PrintRunCard = {
  jobId: "job-1",
  recipientFirstName: "Elise",
  recipientLastName: "Bisby",
  recipientCustomFields: null,
  occasionType: "birthday",
  occasionTitle: null,
  occasionDate: null,
  savedDesignName: "Happy Tulips copy",
  document: document_,
  messagePageSlug: null,
};

function renderOverlay() {
  return render(<PrintRunOverlay cards={[card]} onClose={() => {}} />);
}

describe("PrintRunOverlay — artwork being cropped", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("says how much of a square source will not be printed", async () => {
    // The shape most illustration tools produce, and the one in the screenshot
    // that started this: 29% of its width is cut to reach the card's 1:1.409.
    stubImageLoader({ width: 1000, height: 1000 });
    renderOverlay();

    expect(await screen.findByText(/29% of the artwork/)).toBeInTheDocument();
  });

  it("stays silent about artwork already at the card's proportion", async () => {
    // The discriminator. A warning on every run is one an operator scrolls past,
    // which costs exactly as much as never showing it.
    //
    // 600x845 is the card's proportion to within a rounding hair, and small
    // enough to be low-resolution at A6. The low-resolution line is therefore
    // the *positive* signal that the pre-flight has finished — without it,
    // `waitFor(not.toBeInTheDocument)` passes on its first tick, before anything
    // asynchronous has happened, and would keep passing with the feature
    // deleted. Asserting an absence is only meaningful once something is present.
    stubImageLoader({ width: 600, height: 845 });
    renderOverlay();

    expect(await screen.findByText(/low-resolution/)).toBeInTheDocument();
    // Matched on the warning's own phrasing, not the bare word "artwork" — the
    // toolbar already carries a "Full artwork" toggle, and a matcher that loose
    // fails on a perfectly quiet screen.
    expect(screen.queryByText(/% of the artwork/)).not.toBeInTheDocument();
  });

  it("says nothing about a placed image, which is scaled rather than cropped", async () => {
    // The discriminator for the background-only rule. An image *element* is
    // drawn to its own box — `doc.image(..., { width, height })` server-side, an
    // explicit width and height on the Konva node in the browser — so it scales
    // and never loses its edges. Warning about one would report a crop that is
    // not happening.
    //
    // Without this the filter can be deleted and every test still passes, since
    // the other cards here carry only a background.
    const withElement: DesignDocument = {
      version: 1,
      pages: [
        {
          name: "front",
          elements: [
            {
              kind: "image",
              id: "photo",
              assetUrl: "https://x.supabase.co/storage/v1/object/public/design-assets/acc/el.png",
              x: 40,
              y: 40,
              width: 200,
              height: 200,
              rotation: 0,
            },
          ],
        },
        { name: "inside-left", elements: [] },
        { name: "inside-right", elements: [] },
        { name: "back", elements: [] },
      ],
    };
    // Square, and small enough to be low-resolution at the 200-unit box it sits
    // in — so the low-resolution line proves the pre-flight ran, and the crop
    // line's absence then means something. Under a rule that measured every
    // image rather than backgrounds only, this square source would be reported
    // as 29% cropped.
    stubImageLoader({ width: 300, height: 300 });
    render(<PrintRunOverlay cards={[{ ...card, document: withElement }]} onClose={() => {}} />);

    expect(await screen.findByText(/low-resolution/)).toBeInTheDocument();
    expect(screen.queryByText(/% of the artwork/)).not.toBeInTheDocument();
  });

  it("offers the original artwork on the front, not only the back", async () => {
    // The button was back-only because the back was believed to be "the one face
    // whose render is unfaithful". A cropped front is unfaithful too, and it is
    // the face an operator is most likely to be looking at.
    stubImageLoader({ width: 1000, height: 1000 });
    renderOverlay();

    const buttons = await screen.findAllByRole("button", { name: /Download original artwork/ });
    expect(buttons.length).toBeGreaterThan(0);
  });
});

/**
 * The second finding in docs/card-artwork-crop-plan.md: this preview is not the
 * geometry that prints.
 *
 * The card is drawn 5mm in from the side trim edges so a *browser* print stays
 * clear of an office printer's unprintable margin. The print-ready PDF has no
 * such inset — `faceGeometry` spans the full trim width, full bleed. So an
 * operator asking "is the artwork being cut at the edge?" is looking at a white
 * border the real output does not have, which hides the answer.
 *
 * We do not move the inset (D5 — it is load-bearing for Browser print). We make
 * it legible and say what it is.
 */
describe("PrintRunOverlay — the preview's border is not the printed card", () => {
  it("says the print-ready PDF runs to the trim edge, and how far in this view sits", async () => {
    stubImageLoader({ width: 900, height: 1268 });
    renderOverlay();

    // Both axes, because they differ: the fit clamps on width, so the sides land
    // on the 5mm margin and the vertical gap absorbs the aspect remainder. A
    // notice that said "5mm" flat would be wrong by 2mm top and bottom.
    expect(await screen.findByText(/5mm in from the side trim edges/)).toBeInTheDocument();
    expect(screen.getByText(/7\.1mm from the top and bottom/)).toBeInTheDocument();
    expect(screen.getByText(/runs to the trim edge at 105 × 148 mm/)).toBeInTheDocument();
  });

  it("restates the geometry when the operator switches to A5", async () => {
    // The discriminator against hardcoded copy. A5 is a different page with a
    // different vertical remainder, and the notice has to follow the run.
    stubImageLoader({ width: 900, height: 1268 });
    renderOverlay();

    await userEvent.click(await screen.findByRole("button", { name: "A5" }));

    expect(screen.getByText(/7\.8mm from the top and bottom/)).toBeInTheDocument();
    expect(screen.getByText(/runs to the trim edge at 148 × 210 mm/)).toBeInTheDocument();
  });

  it("shades the band that the PDF prints into and this view does not", async () => {
    stubImageLoader({ width: 900, height: 1268 });
    renderOverlay();

    await screen.findByText(/runs to the trim edge/);
    // The overlay is a portal onto document.body, so the render result's own
    // container holds none of it.
    const bands = document.body.querySelectorAll<HTMLElement>("[data-trim-band]");
    // One per printed face — the gap is on every page, not just the front.
    expect(bands).toHaveLength(4);

    const inset = fittedCardInsetMm("A6");
    for (const band of bands) {
      // The band is drawn *from* the same measurement the notice quotes and the
      // card is fitted by, so the shading cannot drift from the card inside it.
      expect(band.style.borderTopWidth).toBe(`${inset.topMm}mm`);
      expect(band.style.borderLeftWidth).toBe(`${inset.sideMm}mm`);
      // And it must never reach paper. Browser print rasterises what is on
      // screen; a band that printed would put a grey frame on a real card.
      expect(band.className).toContain("print:hidden");
    }
  });
});
