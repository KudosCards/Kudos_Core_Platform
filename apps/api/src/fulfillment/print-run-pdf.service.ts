import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  PRINT_RUN_BLEED_MM,
  applyMergeTokens,
  DEFAULT_CARD_SIZE,
  designDocumentSchema,
  facesOf,
  printedCardMergeContext,
  type CardSize,
} from "@kudos/shared-types";
import { createImageResolver, hostOf, renderRunPdf, type PrintFaceInput } from "../print-pdf";
import type { EnvConfig } from "../config/env.schema";
import { FulfillmentService, type PrintRunCard } from "./fulfillment.service";
import type { ExportAddressesDto } from "./dto/export-addresses.dto";

export interface RenderedPrintRun {
  pdf: Buffer;
  filename: string;
  cardCount: number;
}

/**
 * Renders a fulfilment print run to one print-ready PDF via the server-side
 * engine (docs/adr/0162). It reuses `FulfillmentService.printRun` for the
 * *audited* read of each card's design + recipient, merges the recipient's
 * tokens into the design (as the web overlay does), and draws every face — so
 * the operator downloads a true-vector, bleed-and-crop-marked PDF of the whole
 * run instead of printing a rasterised browser canvas.
 */
@Injectable()
export class PrintRunPdfService {
  private readonly logger = new Logger(PrintRunPdfService.name);

  constructor(
    private readonly fulfillment: FulfillmentService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  async render(
    actorUserId: string,
    dto: ExportAddressesDto,
    size: CardSize = DEFAULT_CARD_SIZE,
  ): Promise<RenderedPrintRun> {
    // Audited read — records a fulfillment_print_run per card, same as the web path.
    const cards = await this.fulfillment.printRun(actorUserId, dto);
    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });

    const faces = cards.flatMap((card) => this.facesForCard(card, webAppUrl));
    if (faces.length === 0) {
      // Every selected card failed validation (or none resolved) — tell the
      // operator, don't stream an empty/invalid PDF.
      throw new BadRequestException("No printable cards in this run.");
    }

    // Only fetch image assets from our own storage + web origins — design
    // documents carry customer-supplied URLs, so an unrestricted server-side
    // fetch would be an SSRF vector (docs/adr/0162).
    const supabaseUrl = this.config.get("SUPABASE_URL", { infer: true });
    const allowedHosts = [hostOf(webAppUrl), hostOf(supabaseUrl)].filter(
      (host): host is string => host !== null,
    );

    const resolver = createImageResolver({
      webBaseUrl: webAppUrl,
      allowedHosts,
      onWarn: (message) => this.logger.warn(message),
    });

    const pdf = await renderRunPdf(faces, {
      size,
      imageResolver: resolver,
      title: `Kudos print run — ${cards.length} card${cards.length === 1 ? "" : "s"}`,
      onWarn: (message) => this.logger.warn(message),
      // Kudos prints and folds these cards rather than trimming them, so the PDF
      // is the exact trim size with no bleed and no crop marks — a clean page to
      // print and fold. (The engine keeps bleed + crop marks available for a
      // future print house that trims.) See docs/adr/0162.
      cropMarks: false,
      // Shared with the crop measurement, which has to describe the geometry
      // this renderer actually uses: at 3mm the background is scaled to fill a
      // larger page and cut back, and a 2:3 source loses 11.1% of its height
      // rather than 6%. See docs/card-artwork-shape-plan.md, D5.
      bleedMm: PRINT_RUN_BLEED_MM,
    });

    return {
      pdf,
      cardCount: cards.length,
      filename: `kudos-print-run-${cards.length}-card${cards.length === 1 ? "" : "s"}-${size}.pdf`,
    };
  }

  /** Merge one card's recipient into its design and expand it to one entry per
   * face. A design that fails validation is skipped (logged) so one bad record
   * can't fail the whole run. */
  private facesForCard(card: PrintRunCard, webAppUrl: string): PrintFaceInput[] {
    const parsed = designDocumentSchema.safeParse(card.document);
    if (!parsed.success) {
      this.logger.warn(`print run: skipping card ${card.jobId} — invalid design document`);
      return [];
    }

    const merged = applyMergeTokens(parsed.data, printedCardMergeContext(card));

    const qrUrl = card.messagePageSlug ? `${webAppUrl}/r/${card.messagePageSlug}` : undefined;

    return facesOf(merged).map((face) => ({ document: merged, face, qrUrl }));
  }
}
