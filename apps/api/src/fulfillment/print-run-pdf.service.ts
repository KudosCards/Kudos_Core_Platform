import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  applyMergeTokens,
  DEFAULT_CARD_SIZE,
  designDocumentSchema,
  type CardSize,
  type DesignDocument,
  type DesignPage,
} from "@kudos/shared-types";
import { createImageResolver, hostOf, renderRunPdf, type PrintFaceInput } from "../print-pdf";
import type { EnvConfig } from "../config/env.schema";
import { FulfillmentService, type PrintRunCard } from "./fulfillment.service";
import type { ExportAddressesDto } from "./dto/export-addresses.dto";

/** The faces a card design has, in print order — mirrors the web's `facesOf`. */
const FACE_ORDER: DesignPage["name"][] = ["front", "inside-left", "inside-right", "back"];

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

  async render(actorUserId: string, dto: ExportAddressesDto, size: CardSize = DEFAULT_CARD_SIZE): Promise<RenderedPrintRun> {
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

    const merged = applyMergeTokens(parsed.data, {
      firstName: card.recipientFirstName,
      lastName: card.recipientLastName,
      occasion: occasionLabel(card),
      occasionDate: card.occasionDate,
      customFields: coerceCustomFields(card.recipientCustomFields),
    });

    const qrUrl = card.messagePageSlug ? `${webAppUrl}/r/${card.messagePageSlug}` : undefined;

    return facesOf(merged).map((face) => ({ document: merged, face, qrUrl }));
  }
}

/** The faces present on a design, in canonical print order. */
function facesOf(document: DesignDocument): DesignPage["name"][] {
  const present = new Set(document.pages.map((page) => page.name));
  return FACE_ORDER.filter((name) => present.has(name));
}

/** Human occasion label for the `{occasion}` token: a custom title wins, else the
 * type title-cased — matches the web overlay's `occasionLabel`. */
function occasionLabel(card: PrintRunCard): string | null {
  if (card.occasionTitle) return card.occasionTitle;
  if (!card.occasionType) return null;
  return card.occasionType.charAt(0).toUpperCase() + card.occasionType.slice(1);
}

/** Coerce a recipient's stored custom fields (loose JSON) to the string map the
 * merge engine expects; anything not an object of scalars becomes null. */
function coerceCustomFields(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") out[key] = raw;
    else if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint") {
      out[key] = String(raw);
    }
    // Objects, arrays, null/undefined, functions and symbols are dropped.
  }
  return out;
}
