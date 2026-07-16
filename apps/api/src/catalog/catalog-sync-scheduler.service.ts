import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { CatalogSyncService } from "./catalog-sync.service";

/**
 * Keeps the catalog fresh without an operator having to remember to click
 * "Refresh". Runs nightly; a no-op (with a log line) when Airtable isn't
 * configured, so non-production environments never touch the network.
 */
@Injectable()
export class CatalogSyncSchedulerService {
  private readonly logger = new Logger(CatalogSyncSchedulerService.name);

  constructor(private readonly catalogSync: CatalogSyncService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async run(): Promise<void> {
    if (!this.catalogSync.isConfigured()) {
      this.logger.log("Skipping scheduled catalog sync — Airtable not configured");
      return;
    }
    try {
      const summary = await this.catalogSync.sync();
      this.logger.log(
        `Scheduled catalog sync done: ${summary.created} created, ${summary.updated} updated, ` +
          `${summary.deactivated} deactivated, ${summary.errors.length} errors`,
      );
    } catch (error) {
      // A scheduled failure must not crash the process — log and wait for the
      // next run (or a manual sync from the ops UI).
      this.logger.error(
        `Scheduled catalog sync failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }
}
