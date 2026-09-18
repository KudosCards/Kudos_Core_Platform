import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  backgroundArtworkVerdict,
  DEFAULT_CARD_SIZE,
  judgeableBackgroundUrls,
  type CardSize,
  type DesignDocument,
  type PixelSize,
} from "@kudos/shared-types";
import { hostOf } from "../print-pdf";
import { measureAsset } from "../common/measure-asset";
import type { EnvConfig } from "../config/env.schema";

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
  private measure(url: string, allowedHosts: string[]): Promise<PixelSize | null> {
    return measureAsset(url, { allowedHosts, label: "artwork gate", logger: this.logger });
  }
}
