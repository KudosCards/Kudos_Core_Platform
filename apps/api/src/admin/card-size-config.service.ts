import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { cardSizeSchema, DEFAULT_CARD_SIZE, type CardSize } from "@kudos/shared-types";
import {
  PlatformSettingsService,
  PLATFORM_SETTING_KEYS,
} from "../billing/platform-settings.service";

/**
 * The card size a print run defaults to, stored in the PlatformSetting key→value
 * table so a super admin can change it at runtime (no redeploy). The ops team can
 * still override it per run in the print overlay; this is only the default the
 * overlay opens on. Read-through on each call — it's consulted infrequently (an
 * ops opening the fulfilment queue) and must reflect an edit immediately. Falls
 * back to the house default (A6) when nothing is stored or a stored value is
 * somehow invalid. See docs/adr/0138-print-card-sizes.md.
 */
@Injectable()
export class CardSizeConfigService {
  private readonly logger = new Logger(CardSizeConfigService.name);

  constructor(private readonly settings: PlatformSettingsService) {}

  /** The current default print size (admin-set or the house default). */
  async getDefaultSize(): Promise<CardSize> {
    const raw = await this.settings.get(PLATFORM_SETTING_KEYS.defaultPrintCardSize);
    if (!raw) return DEFAULT_CARD_SIZE;
    const parsed = cardSizeSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn("Stored default print card size failed validation — using the default");
      return DEFAULT_CARD_SIZE;
    }
    return parsed.data;
  }

  /** The bundled house default, so the UI can offer "reset to default". */
  getHouseDefaultSize(): CardSize {
    return DEFAULT_CARD_SIZE;
  }

  /** Validate and persist a new default print size. Rejects an unknown code. */
  async setDefaultSize(size: unknown): Promise<CardSize> {
    const parsed = cardSizeSchema.safeParse(size);
    if (!parsed.success) {
      throw new BadRequestException("Unknown card size — expected A5 or A6");
    }
    await this.settings.set(PLATFORM_SETTING_KEYS.defaultPrintCardSize, parsed.data);
    this.logger.log(`Default print card size updated to ${parsed.data}`);
    return parsed.data;
  }
}
