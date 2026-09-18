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

/** A document with one face, so a back's reserved footer cannot be what makes
 *  the reveal appear. */
function frontOnly(assetUrl: string): DesignDocument {
  return {
    version: 1,
    pages: [{ name: "front", elements: [], background: { type: "image", assetUrl } }],
  };
}

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

/**
 * Phase 1 of docs/card-artwork-shape-plan.md: see what is being cut off.
 *
 * 207 of 217 catalog designs are 2:3 on a 1:1.4095 card and lose 4.5mm off the
 * top and the bottom. Whether that matters is a different question per card — a
 * margin on one, a decapitated character on another — and the printed render is
 * the one view guaranteed not to answer it, because the part in question is the
 * part that is gone.
 */
describe("PrintRunOverlay — showing what will not be printed", () => {
  it("offers the reveal for a cropped background, not only for a back face", async () => {
    // The toggle used to appear only when the run had a back, because the
    // reserved footer was the only thing the render hid. A background losing its
    // edges hides artwork too, on any face.
    stubImageLoader({ width: 1000, height: 1500 }); // 2:3 — the catalog's shape
    render(
      <PrintRunOverlay cards={[{ ...card, document: frontOnly(BACKGROUND) }]} onClose={() => {}} />,
    );

    expect(await screen.findByRole("button", { name: "Full artwork" })).toBeInTheDocument();
  });

  it("says nothing to reveal when every image already fits the card", async () => {
    // The discriminator. A control that is always there is one nobody reads as
    // meaning anything, and on a run with nothing hidden it would reveal
    // nothing — a dead toggle inviting a support ticket.
    // The card's own proportion to within a rounding hair, and small enough to
    // be low-resolution at A6 — so the low-resolution line can serve as the
    // positive signal below. (900 x 1268 is the exact proportion but clears the
    // dpi floor, which would leave nothing to wait for.)
    stubImageLoader({ width: 600, height: 845 });
    render(
      <PrintRunOverlay cards={[{ ...card, document: frontOnly(BACKGROUND) }]} onClose={() => {}} />,
    );

    // The low-resolution line is the positive signal that the pre-flight has
    // finished; without waiting for it the absence below proves nothing.
    expect(await screen.findByText(/low-resolution/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Full artwork" })).not.toBeInTheDocument();
  });

  it("explains what the dimmed area is once the reveal is on", async () => {
    stubImageLoader({ width: 1000, height: 1500 });
    render(
      <PrintRunOverlay cards={[{ ...card, document: frontOnly(BACKGROUND) }]} onClose={() => {}} />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Full artwork" }));

    expect(screen.getByText(/artwork that will not be printed/)).toBeInTheDocument();
    // And it must not be mistaken for a change to the output.
    expect(screen.getByText(/print-ready PDF is unaffected/)).toBeInTheDocument();
  });

  it("refuses Browser print while the reveal is on", async () => {
    // Browser print rasterises what is on screen, and this view deliberately
    // shows artwork that must not reach paper.
    stubImageLoader({ width: 1000, height: 1500 });
    render(
      <PrintRunOverlay cards={[{ ...card, document: frontOnly(BACKGROUND) }]} onClose={() => {}} />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Full artwork" }));

    expect(screen.getByRole("button", { name: "Browser print" })).toBeDisabled();
  });
});

/**
 * Phase 2 of docs/card-artwork-shape-plan.md: say it once, in millimetres.
 *
 * The run used to warn only at `heavy`, on the argument that a per-card line
 * appearing on nearly every run gets scrolled past. Then the first real catalog
 * measurement came back: 207 of 217 designs at an identical 6%. So that
 * threshold meant saying *nothing at all* about almost every cropped card —
 * which is not the same thing as avoiding noise.
 */
describe("PrintRunOverlay — one line about the crop, in millimetres", () => {
  it("speaks up about the 6% the catalog actually loses", async () => {
    // 2:3, the shape of 207 of our 217 designs. Under the old `heavy`-only rule
    // this screen said nothing whatsoever about it.
    stubImageLoader({ width: 1000, height: 1500 });
    renderOverlay();

    expect(await screen.findByText(/4\.5mm off each of the top and bottom/)).toBeInTheDocument();
    // The remedy, in the only units an artwork brief can use.
    expect(screen.getByText(/1240 × 1748/)).toBeInTheDocument();
    // And it points at the view that answers "does that 4.5mm matter?".
    expect(screen.getByText(/Switch to Full artwork/)).toBeInTheDocument();
  });

  it("measures off the sides when the sides are what is being trimmed", async () => {
    // A landscape source loses width, and a card is 105mm that way, not 148.
    // Measured against the wrong axis this would overstate the loss by 40%.
    stubImageLoader({ width: 1500, height: 1000 });
    renderOverlay();

    expect(await screen.findByText(/mm off each side/)).toBeInTheDocument();
  });

  it("stays calm at 6% and raises its voice at 29%", async () => {
    // Amber on 95% of runs is amber nobody sees. The tone has to track whether
    // the composition is really being cut, even though the line itself is
    // always present.
    stubImageLoader({ width: 1000, height: 1500 });
    const { unmount } = renderOverlay();
    const quiet = await screen.findByText(/cropped to fit the card/);
    expect(quiet.className).not.toContain("amber");
    unmount();

    stubImageLoader({ width: 1000, height: 1000 });
    renderOverlay();
    const loud = await screen.findByText(/cropped to fit the card/);
    expect(loud.className).toContain("amber");
  });
});

/**
 * Browser print puts one card face on one page. Since ADR 0249 the PDF puts two
 * faces on a landscape sheet that folds into a card, so under that profile these
 * pages fold into nothing — and the two buttons sit next to each other.
 */
describe("PrintRunOverlay — browser print against the folded-sheet profile", () => {
  const browserPrint = (): HTMLButtonElement =>
    screen.getByRole("button", { name: "Browser print" }) as HTMLButtonElement;

  it("refuses browser print when the printer takes folded sheets", () => {
    render(<PrintRunOverlay cards={[card]} onClose={() => {}} printLayout="folded-sheet" />);
    expect(browserPrint()).toBeDisabled();
  });

  it("says why, on the page rather than only in a tooltip", () => {
    // This button worked yesterday. An operator who finds it dead needs the
    // reason without hovering it, and needs pointing at the thing that does work.
    render(<PrintRunOverlay cards={[card]} onClose={() => {}} printLayout="folded-sheet" />);
    expect(screen.getByText(/takes folded sheets/)).toBeInTheDocument();
    expect(screen.getByText(/Use the PDF/)).toBeInTheDocument();
  });

  it("allows it under the layout whose output this actually is", () => {
    // Gated, not deleted: `face-per-page` is still a selectable profile and one
    // face per page is exactly what it wants.
    render(<PrintRunOverlay cards={[card]} onClose={() => {}} printLayout="face-per-page" />);
    expect(browserPrint()).toBeEnabled();
    expect(screen.queryByText(/takes folded sheets/)).not.toBeInTheDocument();
  });

  it("defaults to refusing when nobody said which printer this is", () => {
    // The house profile is folded-sheet, so a caller that has not been told the
    // answer must get the safe one. The order cockpit renders this overlay
    // without the prop.
    render(<PrintRunOverlay cards={[card]} onClose={() => {}} />);
    expect(browserPrint()).toBeDisabled();
  });

  it("leaves the print-ready PDF alone", () => {
    // The PDF is the output that is correct under either profile, so nothing
    // here may get in its way.
    render(<PrintRunOverlay cards={[card]} onClose={() => {}} printLayout="folded-sheet" />);
    expect(screen.getByRole("button", { name: /Download print-ready PDF/ })).toBeEnabled();
  });
});
