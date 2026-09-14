import { Injectable, Logger } from "@nestjs/common";
import {
  DEFAULT_CARD_SIZE,
  PRINT_RUN_BLEED_MM,
  cropLossPercent,
  cropVerdict,
  croppedAxis,
  idealArtworkPixels,
  printedCropLoss,
  type PixelSize,
} from "@kudos/shared-types";
import {
  PlatformSettingsService,
  PLATFORM_SETTING_KEYS,
} from "../billing/platform-settings.service";

/**
 * Whether the catalog sync refuses artwork that will be cropped.
 *
 * The crop plan's D4 reserved the refusal for the sync — the one place where
 * the artwork is ours and a person can fix it before a customer ever sees it —
 * and deliberately deferred the decision until there was evidence. The evidence
 * arrived: 207 of 217 designs are 2:3 on a 1:1.4095 card. So the refusal must
 * exist, and it must start **off**, because switching it on today would reject
 * 95% of the catalog and empty the library.
 *
 * It is a runtime setting rather than a constant for exactly that reason: the
 * day the re-export lands, ops turn it on and the problem cannot come back. No
 * redeploy, and no window where the gate is on and the artwork is not ready.
 *
 * Off is the safe direction in every ambiguous case — an unset key, a corrupt
 * value — because a wrongly-open gate costs a cropped card and a wrongly-closed
 * one costs the catalog. See docs/card-artwork-shape-plan.md, Phase 5.
 */
@Injectable()
export class CatalogCropGateService {
  private readonly logger = new Logger(CatalogCropGateService.name);

  constructor(private readonly settings: PlatformSettingsService) {}

  /** Whether the sync should currently refuse cropped artwork. */
  async isEnabled(): Promise<boolean> {
    const raw = await this.settings.get(PLATFORM_SETTING_KEYS.catalogRejectCroppedArtwork);
    if (raw === null) return false;
    if (raw !== "true" && raw !== "false") {
      this.logger.warn(
        `Stored catalog crop gate value ${JSON.stringify(raw)} is not a boolean — leaving the gate open`,
      );
      return false;
    }
    return raw === "true";
  }

  async setEnabled(enabled: boolean): Promise<boolean> {
    await this.settings.set(
      PLATFORM_SETTING_KEYS.catalogRejectCroppedArtwork,
      enabled ? "true" : "false",
    );
    this.logger.log(`Catalog crop gate ${enabled ? "closed" : "opened"}`);
    return enabled;
  }

  /**
   * Why this artwork may not be stored, or null to let it through. Pure given
   * the gate state.
   *
   * Measured against what the press produces, and refused on *any* loss the
   * floor does not forgive rather than only a heavy one: the whole catalog sits
   * at 6%, so a heavy-only gate would let back in precisely the thing this
   * exists to stop.
   */
  refusalReason(natural: PixelSize, gateEnabled: boolean): string | null {
    if (!gateEnabled) return null;
    const loss = printedCropLoss(natural, {
      size: DEFAULT_CARD_SIZE,
      bleedMm: PRINT_RUN_BLEED_MM,
    });
    const axis = croppedAxis(loss);
    if (axis === null || cropVerdict(loss) === "ok") return null;
    const ideal = idealArtworkPixels(DEFAULT_CARD_SIZE);
    return (
      `Artwork is ${natural.width} × ${natural.height}, so ${cropLossPercent(loss)}% of its ` +
      `${axis} would be cropped off to fit the card. Re-export at ${ideal.width} × ${ideal.height} ` +
      `and re-attach in Airtable.`
    );
  }
}
