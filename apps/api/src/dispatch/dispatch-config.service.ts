import { BadRequestException, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import {
  DEFAULT_SEASONAL_DISPATCH_RULES,
  getSeasonalDispatchRules,
  seasonalDispatchRulesSchema,
  setSeasonalDispatchRules,
  type SeasonalDispatchRule,
} from "@kudos/shared-types";
import { PlatformSettingsService, PLATFORM_SETTING_KEYS } from "../billing/platform-settings.service";

/**
 * Loads the admin-configured seasonal dispatch rules from the PlatformSetting
 * store into the shared engine's active rule set, so `computeDispatchDate` /
 * `suggestFirstClass` honour them everywhere with no per-call plumbing. It's a
 * process-wide in-memory cache (the rules change ~yearly), refreshed on boot,
 * every few minutes (so a change on one API instance reaches the others), and
 * immediately on an admin edit. Falls back to the bundled Christmas default when
 * nothing is stored. See docs/adr/0059-configurable-seasonal-dispatch.md.
 */
@Injectable()
export class DispatchConfigService implements OnModuleInit {
  private readonly logger = new Logger(DispatchConfigService.name);

  constructor(private readonly settings: PlatformSettingsService) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
  }

  /** Re-read the stored rules and apply them to the engine. Cheap; safe to call
   * on a timer so multiple API instances converge after an edit. */
  @Interval(5 * 60 * 1000)
  async reload(): Promise<void> {
    try {
      setSeasonalDispatchRules(await this.load());
    } catch (error) {
      // Never let a bad stored value break dispatch maths — keep the last-good
      // (or default) rules and log it for ops.
      this.logger.error(`Failed to load seasonal dispatch rules: ${String(error)}`);
    }
  }

  /** The rules the engine is currently using (admin-configured or the default). */
  getRules(): readonly SeasonalDispatchRule[] {
    return getSeasonalDispatchRules();
  }

  /** The bundled default, so the UI can offer "reset to default". */
  getDefaultRules(): readonly SeasonalDispatchRule[] {
    return DEFAULT_SEASONAL_DISPATCH_RULES;
  }

  /**
   * Validate and persist a new rule set (or the default), then apply it
   * immediately to this instance. Rejects an invalid window (e.g. day 32).
   */
  async updateRules(rules: unknown): Promise<readonly SeasonalDispatchRule[]> {
    const parsed = seasonalDispatchRulesSchema.safeParse(rules);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid seasonal rules");
    }
    await this.settings.set(PLATFORM_SETTING_KEYS.dispatchSeasonalRules, JSON.stringify(parsed.data));
    setSeasonalDispatchRules(parsed.data);
    this.logger.log(`Seasonal dispatch rules updated (${parsed.data.length} window(s))`);
    return parsed.data;
  }

  /** Read + validate the stored rules, falling back to the default. */
  private async load(): Promise<readonly SeasonalDispatchRule[]> {
    const raw = await this.settings.get(PLATFORM_SETTING_KEYS.dispatchSeasonalRules);
    if (!raw) return DEFAULT_SEASONAL_DISPATCH_RULES;
    const parsed = seasonalDispatchRulesSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      this.logger.warn("Stored seasonal dispatch rules failed validation — using the default");
      return DEFAULT_SEASONAL_DISPATCH_RULES;
    }
    return parsed.data;
  }
}
