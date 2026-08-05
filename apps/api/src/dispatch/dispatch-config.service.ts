import { BadRequestException, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import {
  DEFAULT_DISPATCH_REMINDER_CONFIG,
  DEFAULT_SEASONAL_DISPATCH_RULES,
  dispatchReminderConfigSchema,
  getSeasonalDispatchRules,
  seasonalDispatchRulesSchema,
  setSeasonalDispatchRules,
  type DispatchReminderConfig,
  type SeasonalDispatchRule,
} from "@kudos/shared-types";
import {
  PlatformSettingsService,
  PLATFORM_SETTING_KEYS,
} from "../billing/platform-settings.service";

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
    await this.settings.set(
      PLATFORM_SETTING_KEYS.dispatchSeasonalRules,
      JSON.stringify(parsed.data),
    );
    setSeasonalDispatchRules(parsed.data);
    this.logger.log(`Seasonal dispatch rules updated (${parsed.data.length} window(s))`);
    return parsed.data;
  }

  /** The current send-by-5 reminder config (ops-edited or the default). Read
   * through on each call — it's consulted infrequently (an hourly cron + the ops
   * must-ship reads) and must reflect an edit on any instance immediately. */
  async getReminderConfig(): Promise<DispatchReminderConfig> {
    const raw = await this.settings.get(PLATFORM_SETTING_KEYS.dispatchReminderConfig);
    if (!raw) return DEFAULT_DISPATCH_REMINDER_CONFIG;
    const parsed = dispatchReminderConfigSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      this.logger.warn("Stored dispatch reminder config failed validation — using the default");
      return DEFAULT_DISPATCH_REMINDER_CONFIG;
    }
    return parsed.data;
  }

  /** The bundled default, so the UI can offer "reset to default". */
  getDefaultReminderConfig(): DispatchReminderConfig {
    return DEFAULT_DISPATCH_REMINDER_CONFIG;
  }

  /** Validate and persist a new reminder config. Rejects an out-of-range value. */
  async updateReminderConfig(config: unknown): Promise<DispatchReminderConfig> {
    const parsed = dispatchReminderConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid reminder config");
    }
    await this.settings.set(
      PLATFORM_SETTING_KEYS.dispatchReminderConfig,
      JSON.stringify(parsed.data),
    );
    this.logger.log(
      `Dispatch reminder config updated (enabled=${parsed.data.enabled}, hour=${parsed.data.sendHourUtc})`,
    );
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
