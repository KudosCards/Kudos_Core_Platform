import type { ConfigService } from "@nestjs/config";
import type { DesignDocument } from "@kudos/shared-types";
import { PrintRunPdfService } from "./print-run-pdf.service";
import type { FulfillmentService, PrintRunCard } from "./fulfillment.service";
import { renderRunPdf } from "../print-pdf";

// Mock the engine so we can inspect the faces it's handed (merge + faces + qrUrl)
// without parsing PDF bytes.
jest.mock("../print-pdf", () => ({
  renderRunPdf: jest.fn().mockResolvedValue(Buffer.from("%PDF-mock")),
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
  const service = new PrintRunPdfService(fulfillment, config);

  beforeEach(() => {
    renderRunPdfMock.mockClear();
    printRun.mockReset();
  });

  it("reuses the audited printRun read and renders merged faces", async () => {
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
    printRun.mockResolvedValue([card()]);
    await service.render("actor-1", { jobIds: ["job-1"] }, "A5");
    expect(renderRunPdfMock.mock.calls[0]![1]).toMatchObject({ size: "A5" });
  });

  it("renders a clean print-and-fold page: no crop marks, no bleed", async () => {
    printRun.mockResolvedValue([card()]);
    await service.render("actor-1", { jobIds: ["job-1"] }, "A6");
    expect(renderRunPdfMock.mock.calls[0]![1]).toMatchObject({ cropMarks: false, bleedMm: 0 });
  });

  it("skips a card whose design document is invalid without failing the run", async () => {
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
    printRun.mockResolvedValue([card({ messagePageSlug: null })]);
    await service.render("actor-1", { jobIds: ["job-1"] }, "A6");
    const faces = renderRunPdfMock.mock.calls[0]![0];
    expect(faces[0]!.qrUrl).toBeUndefined();
  });
});
