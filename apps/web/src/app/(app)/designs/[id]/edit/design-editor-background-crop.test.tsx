import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SavedDesign } from "@kudos/shared-types";
import { DesignEditorClient } from "./design-editor-client";

jest.mock("@/lib/api.client", () => ({ clientApiFetch: () => Promise.resolve({}) }));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));
jest.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: jest.fn() }) } }),
}));
// Konva does not render under jsdom, and none of this is about the picture.
jest.mock("./design-canvas", () => ({ DesignCanvas: () => <div data-testid="canvas" /> }));

/**
 * Phase 4 of docs/card-artwork-crop-plan.md: the customer is told before they
 * buy.
 *
 * A page background is drawn full-bleed and centre-cropped to the card's
 * 1:1.409 — correct, undistorted, and silent. A square source, the default
 * output of most illustration tools, loses 29% of its width. The editor is the
 * one surface where that is still free to fix, and it said nothing.
 */

/**
 * Stand in for the browser's image loader, per url, so a test can say what shape
 * each background is. `loadNaturalSize` only reads naturalWidth/Height.
 *
 * A url can also be "error" (the load fails) or "pending" (it never settles, so
 * a test can look at the panel while a measurement is still in flight). An
 * unlisted url errors, which is the safer default for a stub.
 *
 * Returns a `settle(url)` that finishes a "pending" load late — how a slow
 * network actually behaves, and the only way to reach the case where a
 * measurement lands after the person has already moved to another face.
 */
type StubbedImage = { width: number; height: number } | "error" | "pending";

function stubImageLoader(images: Record<string, StubbedImage>) {
  const held = new Map<string, StubImage>();
  class StubImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    set src(value: string) {
      const stubbed = images[value] ?? "error";
      if (stubbed === "pending") {
        held.set(value, this);
        return;
      }
      if (stubbed !== "error") {
        this.naturalWidth = stubbed.width;
        this.naturalHeight = stubbed.height;
      }
      // Asynchronous, like a real load, so the effect's await actually awaits.
      setTimeout(() => (stubbed === "error" ? this.onerror?.() : this.onload?.()), 0);
    }
  }
  Object.defineProperty(window, "Image", { configurable: true, value: StubImage });
  return function settle(url: string, size: { width: number; height: number }) {
    const img = held.get(url);
    if (!img) throw new Error(`no pending load for ${url}`);
    img.naturalWidth = size.width;
    img.naturalHeight = size.height;
    img.onload?.();
  };
}

const SQUARE = "https://cdn.test/square.png";
const FITS = "https://cdn.test/fits.png";
const NEARLY = "https://cdn.test/nearly.png";
const A6 = "https://cdn.test/a6.png";

/** Wait until the panel says it has finished measuring this face, and report
 *  what it found. Asserting an absence before this is asserting nothing: the
 *  measurement is asynchronous, so a "says nothing" test written without it
 *  passes on its first tick and would keep passing with the feature deleted. */
function backgroundPanel(): HTMLElement {
  const panel = screen.getByText(/^Background — /).closest("div");
  if (!panel) throw new Error("background panel not found");
  return panel as HTMLElement;
}

async function verdictOnScreen(): Promise<string | null> {
  await waitFor(() => {
    expect(backgroundPanel()).not.toHaveAttribute("data-background-crop", "measuring");
  });
  return backgroundPanel().getAttribute("data-background-crop");
}

function designWith(backgrounds: Partial<Record<"front" | "inside-left", string>>): SavedDesign {
  const page = (name: string) => ({
    name,
    elements: [],
    ...(backgrounds[name as "front"]
      ? { background: { type: "image", assetUrl: backgrounds[name as "front"] } }
      : {}),
  });
  return {
    id: "d-1",
    name: "Happy Tulips copy",
    document: {
      pages: [page("front"), page("inside-left"), page("inside-right"), page("back")],
    },
  } as unknown as SavedDesign;
}

describe("DesignEditorClient — a background that will be cropped", () => {
  it("says how much of a square background will not be printed", async () => {
    // The shape in the screenshot that started this: 29% of its width cut to
    // reach the card's proportion, with nothing anywhere saying so.
    stubImageLoader({ [SQUARE]: { width: 1000, height: 1000 } });
    render(
      <DesignEditorClient
        savedDesign={designWith({ front: SQUARE })}
        messagePages={[]}
        canAuthorMessagePages={false}
      />,
    );

    const note = await screen.findByText(/29% of the width of this image will not be printed/);
    expect(note).toBeInTheDocument();
    // And what would fit, so the note is actionable rather than just bad news.
    expect(note).toHaveTextContent(/1050 × 1480/);
    // Heavy enough to be worth flagging loudly.
    expect(note.className).toContain("amber");
  });

  it("mentions a smaller loss without shouting about it", async () => {
    // 3:4 loses 5%. Too much to throw away silently, not enough to alarm
    // somebody — the ops run deliberately stays quiet about this one, because a
    // warning on nearly every card is one that gets scrolled past. Here, where
    // the person can still change the artwork, it is worth saying.
    stubImageLoader({ [NEARLY]: { width: 1000, height: 1333 } });
    render(
      <DesignEditorClient
        savedDesign={designWith({ front: NEARLY })}
        messagePages={[]}
        canAuthorMessagePages={false}
      />,
    );

    const note = await screen.findByText(/5% of the width of this image will not be printed/);
    expect(note.className).not.toContain("amber");
  });

  it("measures the face being looked at, not every face in the design", async () => {
    // The discriminator, and its own positive signal. The front fits, so the
    // panel must stay quiet — but an absence only means something once
    // something is present, so the same render then switches to the inside-left
    // face, whose background is square, and the note has to appear there.
    //
    // Under a rule that scanned the whole document the front would be reported
    // as 29% cropped, which is a warning about a face the person is not editing.
    stubImageLoader({
      [FITS]: { width: 900, height: 1268 },
      [SQUARE]: { width: 1000, height: 1000 },
    });
    render(
      <DesignEditorClient
        savedDesign={designWith({ front: FITS, "inside-left": SQUARE })}
        messagePages={[]}
        canAuthorMessagePages={false}
      />,
    );
    await screen.findByText("Background — front");
    expect(await verdictOnScreen()).toBe("ok");
    expect(screen.queryByText(/will not be printed/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "inside-left" }));

    expect(
      await screen.findByText(/29% of the width of this image will not be printed/),
    ).toBeInTheDocument();

    // And it has to let go again. A number measured against one face, still on
    // screen beside another face's artwork, is worse than no number: it is a
    // confident wrong one.
    await userEvent.click(screen.getByRole("button", { name: "inside-right" }));
    await screen.findByText("Background — inside-right");
    // No image background at all on this face — a different state from "fine".
    expect(await verdictOnScreen()).toBe("none");
    expect(screen.queryByText(/will not be printed/)).not.toBeInTheDocument();
  });

  it("stays quiet about artwork commissioned at true A6", async () => {
    // The floor. A card is 1:1.409 and almost nothing is authored at exactly
    // that — 1050 × 1480 is A6 in tenths of a millimetre and still loses about
    // 0.05% of its height, four hundredths of a millimetre. A rule with no floor
    // would flag every image on the platform and be ignored within a week.
    //
    // The silence is checked against a verdict the panel has actually reached,
    // and then the same render moves to a face whose background is square — so
    // this is silence from a measurement that ran, not from one that had not
    // started yet.
    stubImageLoader({
      [A6]: { width: 1050, height: 1480 },
      [SQUARE]: { width: 1000, height: 1000 },
    });
    render(
      <DesignEditorClient
        savedDesign={designWith({ front: A6, "inside-left": SQUARE })}
        messagePages={[]}
        canAuthorMessagePages={false}
      />,
    );
    await screen.findByText("Background — front");
    // Measured, and judged ok — not merely unmeasured. Without this the absence
    // below would pass with the floor removed, reporting "0% ... will not be
    // printed" a tick later than the assertion looked.
    expect(await verdictOnScreen()).toBe("ok");
    expect(screen.queryByText(/will not be printed/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "inside-left" }));
    expect(await screen.findByText(/29% of the width/)).toBeInTheDocument();
  });

  it("drops the previous face's number while the next one is still loading", async () => {
    // The stale-number window. Switching faces starts a new measurement, and
    // until it lands the panel must say it is measuring rather than keep the
    // last face's figure on screen. A confident wrong number beside somebody's
    // artwork is worse than no number.
    stubImageLoader({ [SQUARE]: { width: 1000, height: 1000 }, [NEARLY]: "pending" });
    render(
      <DesignEditorClient
        savedDesign={designWith({ front: SQUARE, "inside-left": NEARLY })}
        messagePages={[]}
        canAuthorMessagePages={false}
      />,
    );
    expect(await screen.findByText(/29% of the width/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "inside-left" }));

    await waitFor(() => {
      expect(backgroundPanel()).toHaveAttribute("data-background-crop", "measuring");
    });
    expect(screen.queryByText(/will not be printed/)).not.toBeInTheDocument();
  });

  it("says nothing about a background it could not read", async () => {
    // A load failure must not produce a warning about artwork nobody measured —
    // and it must not read as "measured and fine" either, which would be a
    // reassurance we have not earned.
    stubImageLoader({ [SQUARE]: "error" });
    render(
      <DesignEditorClient
        savedDesign={designWith({ front: SQUARE })}
        messagePages={[]}
        canAuthorMessagePages={false}
      />,
    );

    expect(await verdictOnScreen()).toBe("unreadable");
    expect(screen.queryByText(/will not be printed/)).not.toBeInTheDocument();
  });

  it("ignores a measurement that lands after the face has moved on", async () => {
    // The out-of-order case. A slow load for the front can finish after the
    // person has already switched to a face with no background at all, and the
    // state it would then write belongs to artwork that is no longer on screen.
    //
    // Nothing above reaches this: a load that never settles cannot arrive late.
    const settle = stubImageLoader({ [SQUARE]: "pending" });
    render(
      <DesignEditorClient
        savedDesign={designWith({ front: SQUARE })}
        messagePages={[]}
        canAuthorMessagePages={false}
      />,
    );
    await waitFor(() => {
      expect(backgroundPanel()).toHaveAttribute("data-background-crop", "measuring");
    });

    await userEvent.click(screen.getByRole("button", { name: "inside-left" }));
    expect(await verdictOnScreen()).toBe("none");

    // Inside act, so the late resolution's state write — if the effect makes one
    // — is flushed to the DOM before it is judged. Asserted outside act this
    // reads the previous render and passes either way.
    await act(async () => {
      settle(SQUARE, { width: 1000, height: 1000 });
    });

    expect(backgroundPanel()).toHaveAttribute("data-background-crop", "none");
    expect(screen.queryByText(/will not be printed/)).not.toBeInTheDocument();
  });
});
