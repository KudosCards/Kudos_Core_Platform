import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { StorageReaperService } from "./storage-reaper.service";
import { PLATFORM_TIME_ZONE } from "../common/scheduling";

/**
 * Runs the orphaned-asset reaper nightly. A no-op (with a log line) unless
 * STORAGE_REAPER_ENABLED is set, so non-production and un-opted-in environments
 * never delete anything. See docs/adr/0074-orphaned-asset-reaper.md.
 */
@Injectable()
export class StorageReaperSchedulerService {
  private readonly logger = new Logger(StorageReaperSchedulerService.name);

  constructor(private readonly reaper: StorageReaperService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { timeZone: PLATFORM_TIME_ZONE })
  async run(): Promise<void> {
    if (!this.reaper.isEnabled()) {
      this.logger.log("Skipping scheduled storage reap — STORAGE_REAPER_ENABLED not set");
      return;
    }
    try {
      const summary = await this.reaper.reap();
      this.logger.log(
        `Scheduled storage reap done: ${summary.deleted} deleted of ${summary.orphaned} orphaned ` +
          `(${summary.scanned} scanned, ${summary.recentlyUploaded} within grace` +
          `${summary.capped ? ", capped — more remain for next run" : ""})`,
      );
    } catch (error) {
      // A scheduled failure must not crash the process — log and wait for the
      // next run (or a manual trigger from the ops endpoint).
      this.logger.error(
        `Scheduled storage reap failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }
}
