import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { CrmConnectionsService } from "./crm-connections.service";

/**
 * Nightly sweep: re-sync every enabled CRM connection so recipients stay
 * current without anyone clicking "Sync now". 5am — staggered from the other
 * crons (catalog 4am, birthdays 6am, auto-send 7am). One connection failing
 * (e.g. a revoked key) is logged and skipped, never aborting the rest.
 */
@Injectable()
export class CrmSyncScheduler {
  private readonly logger = new Logger(CrmSyncScheduler.name);

  constructor(private readonly crmConnections: CrmConnectionsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_5AM)
  async run(): Promise<void> {
    const connections = await this.crmConnections.listEnabled();
    for (const connection of connections) {
      try {
        await this.crmConnections.sync(connection.accountId, "system:crm-sync", connection.provider);
      } catch (error) {
        this.logger.warn(
          `Scheduled CRM sync failed for ${connection.accountId}/${connection.provider}: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    }
  }
}
