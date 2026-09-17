import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { DEFAULT_PRINT_PROFILE, printProfileSchema, type PrintProfile } from "@kudos/shared-types";
import {
  PlatformSettingsService,
  PLATFORM_SETTING_KEYS,
} from "../billing/platform-settings.service";

/**
 * How the print engine lays a run out on paper, stored in the PlatformSetting
 * key→value table so a super admin can change it at runtime.
 *
 * This describes the *printer*, not the run: the sheet it takes, how much a
 * borderless pass enlarges by, and whether the back's footer is already on the
 * stock. That is why it lives here rather than in the print overlay — ops choose
 * a card size per run, but they do not choose a different printer per run.
 *
 * Read-through on each call: it is consulted once per export and must reflect an
 * edit immediately. An unreadable or invalid stored value falls back to the
 * bundled default rather than failing the export — a bad settings row must not
 * stop ops printing today's cards. See docs/card-print-quality-plan.md (P4).
 */
@Injectable()
export class PrintProfileService {
  private readonly logger = new Logger(PrintProfileService.name);

  constructor(private readonly settings: PlatformSettingsService) {}

  /** The profile in force (admin-set or the bundled default). */
  async getProfile(): Promise<PrintProfile> {
    const raw = await this.settings.get(PLATFORM_SETTING_KEYS.printProfile);
    if (!raw) return DEFAULT_PRINT_PROFILE;

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      this.logger.warn("Stored print profile is not valid JSON — using the default");
      return DEFAULT_PRINT_PROFILE;
    }

    const parsed = printProfileSchema.safeParse(parsedJson);
    if (!parsed.success) {
      this.logger.warn("Stored print profile failed validation — using the default");
      return DEFAULT_PRINT_PROFILE;
    }
    return parsed.data;
  }

  /** The bundled default, so the UI can offer "reset to default". */
  getHouseDefaultProfile(): PrintProfile {
    return DEFAULT_PRINT_PROFILE;
  }

  /** Validate and persist a profile. Rejects an unknown layout or an overhang
   * outside the range a ruler could plausibly show. */
  async setProfile(profile: unknown): Promise<PrintProfile> {
    const parsed = printProfileSchema.safeParse(profile);
    if (!parsed.success) {
      throw new BadRequestException(
        "Invalid print profile — check the layout and the borderless overhang.",
      );
    }
    await this.settings.set(PLATFORM_SETTING_KEYS.printProfile, JSON.stringify(parsed.data));
    this.logger.log(
      `Print profile updated: layout=${parsed.data.layout}, ` +
        `borderlessOverhangMm=${parsed.data.borderlessOverhangMm}`,
    );
    return parsed.data;
  }
}
