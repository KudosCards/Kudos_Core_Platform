import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { designDocumentSchema, documentAssetUrls } from "@kudos/shared-types";
import { absoluteUrl, fetchAssetBytes, hostOf, isHostAllowed } from "../print-pdf";
import type { EnvConfig } from "../config/env.schema";
import { FulfillmentService } from "./fulfillment.service";
import type { DownloadArtworkDto } from "./dto/download-artwork.dto";

/** An original asset, ready to stream to the operator untouched. */
export interface OriginalArtwork {
  bytes: Buffer;
  contentType: string;
  filename: string;
}

/** Uploads are stored at `<accountId>/<uuid>-<original file name>` (see
 * StorageService), so the customer's own file name is recoverable by stripping
 * the uuid we prefixed. */
const UPLOAD_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(?=.)/i;

/**
 * Hand an operator the *original* file a customer uploaded, byte for byte.
 *
 * Everything else in the product shows a card face: a fixed 450×634 canvas with
 * the background cover-cropped into it and, on the back, the reserved footer
 * clipped away (docs/adr/0166). All of those are renders. When artwork doesn't
 * fit and someone has to decide what to do about it, a render of the part that
 * survived is precisely the wrong artefact — the only faithful copy is the
 * upload itself.
 */
@Injectable()
export class PrintRunArtworkService {
  private readonly logger = new Logger(PrintRunArtworkService.name);

  constructor(
    private readonly fulfillment: FulfillmentService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  async downloadOriginal(actorUserId: string, dto: DownloadArtworkDto): Promise<OriginalArtwork> {
    // Audited read, the same one the print run and its PDF use — downloading a
    // customer's artwork is a look at their content and is recorded as such.
    const [card] = await this.fulfillment.printRun(actorUserId, { jobIds: [dto.jobId] });
    if (!card) {
      throw new NotFoundException("Card not found.");
    }

    const parsed = designDocumentSchema.safeParse(card.document);
    if (!parsed.success) {
      throw new BadRequestException("This card's design can't be read.");
    }

    // The URL must be one this design actually references. Design documents
    // carry customer-supplied URLs and this fetch happens server-side, so taking
    // the client's word for it would be a confused-deputy SSRF vector. Belt and
    // braces: the host allowlist below is the same one the print engine applies.
    if (!documentAssetUrls(parsed.data).has(dto.assetUrl)) {
      throw new BadRequestException("That artwork isn't part of this card's design.");
    }

    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    const supabaseUrl = this.config.get("SUPABASE_URL", { infer: true });
    const allowedHosts = [hostOf(webAppUrl), hostOf(supabaseUrl)].filter(
      (host): host is string => host !== null,
    );

    const url = absoluteUrl(dto.assetUrl, webAppUrl);
    if (!url || !isHostAllowed(url, allowedHosts)) {
      throw new BadRequestException("That artwork isn't stored somewhere we can fetch from.");
    }

    const fetched = await fetchAssetBytes(url, {
      allowedHosts,
      onWarn: (message) => this.logger.warn(message),
    });
    if (!fetched) {
      throw new BadRequestException("Could not fetch that artwork — it may have been removed.");
    }

    return {
      bytes: fetched.buffer,
      contentType: fetched.contentType ?? "application/octet-stream",
      filename: originalFileName(url),
    };
  }
}

/**
 * The customer's own file name, recovered from the storage path and made safe to
 * put in a Content-Disposition header.
 *
 * Quotes, backslashes and control characters are stripped rather than escaped:
 * the name is untrusted (it came from an upload) and this value lands in a
 * response header, where a stray quote ends the field early.
 */
export function originalFileName(url: string): string {
  let base: string;
  try {
    base = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    base = "";
  }
  const withoutPrefix = base.replace(UPLOAD_PREFIX, "");
  // eslint-disable-next-line no-control-regex
  const safe = withoutPrefix.replace(/[\x00-\x1f"\\]/g, "").trim();
  return safe.length > 0 ? safe : "artwork";
}
