import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import sharp from "sharp";
import {
  backgroundArtworkVerdict,
  DEFAULT_CARD_SIZE,
  judgeableBackgroundUrls,
  MAX_DECODE_PIXELS,
  orientedPixelSize,
  type CardSize,
  type DesignDocument,
  type PixelSize,
} from "@kudos/shared-types";
import { fetchAssetBytes, hostOf, isHostAllowed } from "../print-pdf";
import type { EnvConfig } from "../config/env.schema";

/** Bounded well below the print engine's cap: this reads a header, not a card. */
const GATE_MAX_BYTES = 30 * 1024 * 1024;
const GATE_TIMEOUT_MS = 8_000;

/**
 * The server half of the artwork gate (docs/card-print-quality-plan.md, D5).
 *
 * The browser refuses a bad background before a byte is uploaded, which is where
 * a customer wants to hear it. This is the half that cannot be bypassed: a stale
 * tab, a forged request, an asset uploaded before the rule existed, or a future
 * surface that forgets. It runs at `parseDocument` — the same choke point ADR
 * 0171 chose for the reserved footer, and for the same reason: it is the only
 * place every route into a stored design passes through, including the two that
 * create orders straight through Prisma and never touch the checkout service.
 *
 * **Fail open on infrastructure, closed on artwork.** If storage is unreachable,
 * the URL is not ours, or the bytes are not an image, the save proceeds with a
 * line in the log. The pre-upload check has already had its say, and a storage
 * blip must not stop every customer saving every design. A file that *is*
 * measured and *is* wrong is refused.
 */
@Injectable()
export class ArtworkGateService {
  private readonly logger = new Logger(ArtworkGateService.name);

  constructor(private readonly config: ConfigService<EnvConfig, true>) {}

  /**
   * Refuse the save if a background new to this design cannot be printed.
   *
   * `previous` is the document already stored, so a background the design
   * already carried is left alone — see `judgeableBackgroundUrls`.
   */
  async assertAcceptable(
    document: DesignDocument,
    previous?: DesignDocument | null,
    size: CardSize = DEFAULT_CARD_SIZE,
  ): Promise<void> {
    const urls = judgeableBackgroundUrls(document, previous);
    if (urls.length === 0) return;

    // Only our own storage. A design document carries customer-supplied URLs, so
    // an unrestricted server-side fetch here would be the same confused-deputy
    // SSRF the print engine is allowlisted against (ADR 0162).
    const allowed = [hostOf(this.config.get("SUPABASE_URL", { infer: true }))].filter(
      (host): host is string => host !== null,
    );

    for (const url of urls) {
      const natural = await this.measure(url, allowed);
      if (!natural) continue;
      const refusal = backgroundArtworkVerdict(natural, size);
      if (refusal) throw new BadRequestException(refusal.message);
    }
  }

  /** The artwork's size as the card will show it, or null if we cannot tell. */
  private async measure(url: string, allowedHosts: string[]): Promise<PixelSize | null> {
    if (!isHostAllowed(url, allowedHosts)) {
      // Not our storage, so not ours to judge — and the print engine will not
      // fetch it either. Left to the pre-flight the operator sees.
      return null;
    }
    try {
      const fetched = await fetchAssetBytes(url, {
        maxBytes: GATE_MAX_BYTES,
        timeoutMs: GATE_TIMEOUT_MS,
        onWarn: (message) => this.logger.warn(`artwork gate: ${message}`),
      });
      if (!fetched) return null;
      const meta = await sharp(fetched.buffer, { limitInputPixels: MAX_DECODE_PIXELS }).metadata();
      if (!meta.width || !meta.height) return null;
      // The same correction the renderer applies. Measuring the stored size
      // would refuse a correctly-shaped phone photo as heavily cropped — see
      // ADR 0247.
      return orientedPixelSize({ width: meta.width, height: meta.height }, meta.orientation);
    } catch (error) {
      this.logger.warn(`artwork gate: could not measure ${url}: ${String(error)}`);
      return null;
    }
  }
}
