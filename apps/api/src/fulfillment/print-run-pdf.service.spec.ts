import type { ConfigService } from "@nestjs/config";
import type { DesignDocument } from "@kudos/shared-types";
import { PrintRunPdfService } from "./print-run-pdf.service";
import type { FulfillmentService, PrintRunCard } from "./fulfillment.service";
import { renderFoldedRunPdf, renderRunPdf } from "../print-pdf";
import type { PrintProfileService } from "../admin/print-profile.service";
import { DEFAULT_PRINT_PROFILE, type PrintProfile } from "@kudos/shared-types";

// Mock the engine so we can inspect what it's handed (merge + faces + qrUrl)
// without parsing PDF bytes.
jest.mock("../print-pdf", () => ({
  renderRunPdf: jest.fn().mockResolvedValue(Buffer.from("%PDF-mock")),
  renderFoldedRunPdf: jest.fn().mockResolvedValue(Buffer.from("%PDF-folded")),
  createImageResolver: jest.fn().mockReturnValue(() => Promise.resolve(null)),
  hostOf: (url: string) => {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  },
}));

const renderRunPdfMock = renderRunPdf as jest.MockedFunction<typeof renderRunPdf>;
const renderFoldedMock = renderFoldedRunPdf as jest.MockedFunction<typeof renderFoldedRunPdf>;

function validDocument(text: string): DesignDocument {
  return {
    version: 1,
    pages: [
      {
        name: "front",
        elements: [
          {
            kind: "text",
            id: "t",
            text,
            x: 10,
            y: 10,
            fontFamily: "Montserrat",
            fontSize: 20,
            color: "#111111",
          },
        ],
      },
      { name: "inside-right", elements: [] },
    ],
  };
}

function card(overrides: Partial<PrintRunCard> = {}): PrintRunCard {
  return {
    jobId: "job-1",
    recipientFirstName: "Sam",
    recipientLastName: "Lee",
    recipientCustomFields: null,
    occasionType: "birthday",
    occasionTitle: null,
    occasionDate: null,
    savedDesignName: "Balloons",
    document: validDocument("Dear {firstName},"),
    messagePageSlug: "abc123",
    ...overrides,
  };
}

describe("PrintRunPdfService", () => {
  const printRun = jest.fn();
  const fulfillment = { printRun } as unknown as FulfillmentService;
  const config = { get: () => "https://app.example.com" } as unknown as ConfigService<never, true>;

  // The profile is the printer's, not the run's — every test says which printer
  // it is describing rather than inheriting whatever the default happens to be.
  let profile: PrintProfile = DEFAULT_PRINT_PROFILE;
  const printProfile = {
    getProfile: () => Promise.resolve(profile),
  } as unknown as PrintProfileService;
  const service = new PrintRunPdfService(fulfillment, config, printProfile);

  /** The old one-face-per-page output, still selectable as the fallback. */
  const facePerPage = (): void => {
    profile = { ...DEFAULT_PRINT_PROFILE, layout: "face-per-page" };
  };

  beforeEach(() => {
    renderRunPdfMock.mockClear();
    renderFoldedMock.mockClear();
    printRun.mockReset();
    profile = DEFAULT_PRINT_PROFILE;
  });

  it("reuses the audited printRun read and renders merged faces", async () => {
    facePerPage();
    printRun.mockResolvedValue([card()]);
    const dto = { jobIds: ["job-1"] };

    const result = await service.render("actor-1", dto, "A6");

    // Audited read reused verbatim.
    expect(printRun).toHaveBeenCalledWith("actor-1", dto);

    const faces = renderRunPdfMock.mock.calls[0]![0];
    // Two faces (front + inside-right), each carrying the merged document.
    expect(faces.map((f) => f.face)).toEqual(["front", "inside-right"]);
    const frontText = faces[0]!.document.pages.find((p) => p.name === "front")!.elements[0];
    expect(frontText).toMatchObject({ kind: "text", text: "Dear Sam," });
    // QR URL built from WEB_APP_URL + slug.
    expect(faces[0]!.qrUrl).toBe("https://app.example.com/r/abc123");

    expect(result.cardCount).toBe(1);
    expect(result.filename).toBe("kudos-print-run-1-card-A6.pdf");
    expect(result.pdf.toString()).toBe("%PDF-mock");
  });

  it("passes the chosen size to the engine and filename", async () => {
    facePerPage();
    printRun.mockResolvedValue([card()]);
    await service.render("actor-1", { jobIds: ["job-1"] }, "A5");
    expect(renderRunPdfMock.mock.calls[0]![1]).toMatchObject({ size: "A5" });
  });

  it("renders a clean print-and-fold page: no crop marks, no bleed", async () => {
    facePerPage();
    printRun.mockResolvedValue([card()]);
    await service.render("actor-1", { jobIds: ["job-1"] }, "A6");
    expect(renderRunPdfMock.mock.calls[0]![1]).toMatchObject({ cropMarks: false, bleedMm: 0 });
  });

  it("skips a card whose design document is invalid without failing the run", async () => {
    facePerPage();
    printRun.mockResolvedValue([
      card({ jobId: "bad", document: { nope: true } as unknown as DesignDocument }),
      card({ jobId: "good" }),
    ]);

    const result = await service.render("actor-1", { jobIds: ["bad", "good"] }, "A6");

    const faces = renderRunPdfMock.mock.calls[0]![0];
    // Only the good card's two faces survive; the invalid one contributes none.
    expect(faces).toHaveLength(2);
    // cardCount counts audited cards read (both), not rendered faces.
    expect(result.cardCount).toBe(2);
  });

  it("omits the QR URL when a card has no message-page slug", async () => {
    facePerPage();
    printRun.mockResolvedValue([card({ messagePageSlug: null })]);
    await service.render("actor-1", { jobIds: ["job-1"] }, "A6");
    const faces = renderRunPdfMock.mock.calls[0]![0];
    expect(faces[0]!.qrUrl).toBeUndefined();
  });

  it("sends whole cards to the folded-sheet engine, not a flat list of faces", async () => {
    printRun.mockResolvedValue([card()]);

    const result = await service.render("actor-1", { jobIds: ["job-1"] }, "A6");

    expect(renderRunPdfMock).not.toHaveBeenCalled();
    const cards = renderFoldedMock.mock.calls[0]![0];
    // One entry per card — the sheet needs all four faces together, so the
    // engine does the face expansion, not the caller.
    expect(cards).toHaveLength(1);
    expect(cards[0]!.qrUrl).toBe("https://app.example.com/r/abc123");
    const front = cards[0]!.document.pages.find((p) => p.name === "front")!.elements[0];
    expect(front).toMatchObject({ kind: "text", text: "Dear Sam," });
    expect(result.pdf.toString()).toBe("%PDF-folded");
  });

  it("names the folded output differently — the two are not interchangeable", async () => {
    // An operator with both files in Downloads has to be able to tell a sheet
    // from a card face without opening them.
    printRun.mockResolvedValue([card()]);
    const result = await service.render("actor-1", { jobIds: ["job-1"] }, "A6");
    expect(result.filename).toBe("kudos-print-run-1-card-A6-folded.pdf");
  });

  it("passes the measured overhang and footer mode through to the engine", async () => {
    profile = {
      layout: "folded-sheet",
      borderlessOverhangMm: 2.5,
      borderlessOffsetXMm: -1.75,
      borderlessOffsetYMm: 0,
      backFooter: "print",
    };
    printRun.mockResolvedValue([card()]);

    await service.render("actor-1", { jobIds: ["job-1"] }, "A6");

    expect(renderFoldedMock.mock.calls[0]![1]).toMatchObject({
      borderlessOverhangMm: 2.5,
      borderlessOffsetXMm: -1.75,
      backFooter: "print",
      logoUrl: "https://app.example.com/marketing/logo.png",
    });
  });

  it("still refuses a run in which every card failed validation", async () => {
    printRun.mockResolvedValue([
      card({ jobId: "bad", document: { nope: true } as unknown as DesignDocument }),
    ]);

    await expect(service.render("actor-1", { jobIds: ["bad"] }, "A6")).rejects.toThrow(
      "No printable cards in this run.",
    );
    expect(renderFoldedMock).not.toHaveBeenCalled();
  });
});
