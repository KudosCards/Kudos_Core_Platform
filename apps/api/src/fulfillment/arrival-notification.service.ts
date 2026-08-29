import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ConfigService } from "@nestjs/config";
import type { EnvConfig } from "../config/env.schema";
import { FulfillmentService, type ArrivalSweepResult } from "./fulfillment.service";
import { PLATFORM_TIME_ZONE } from "../common/scheduling";

/**
 * The estimated-arrival notification loop (ADR 0124). Our cards ship on ordinary
 * stamps, which Royal Mail does not track, so we can never observe a real
 * delivery event. Instead a daily sweep estimates arrival from each posted
 * card's posting date + its postage class's expected transit and, once that's
 * passed, marks the card delivered (estimated) and emails the buyer an honest
 * "should have arrived" note.
 *
 * Opt-in: the cron only runs the sweep when ARRIVAL_NOTIFICATIONS_ENABLED is
 * exactly "true"/"1" — because it both emails customers and advances order state
 * on an estimate. Mirrors DispatchReminderService's fire-and-gate shape; the
 * sweep logic itself lives in FulfillmentService.
 */
@Injectable()
export class ArrivalNotificationService {
  private readonly logger = new Logger(ArrivalNotificationService.name);

  constructor(
    private readonly config: ConfigService<EnvConfig, true>,
    private readonly fulfillment: FulfillmentService,
  ) {}

  private enabled(): boolean {
    const value = this.config.get("ARRIVAL_NOTIFICATIONS_ENABLED", { infer: true });
    return value === "true" || value === "1";
  }

  /**
   * Once a day (09:00 UK time, offset from the 07:00 auto-send cron). Arrival is
   * day-granular, so a daily pass is enough. Skips entirely unless enabled.
   */
  @Cron("0 9 * * *", { timeZone: PLATFORM_TIME_ZONE })
  async scheduledSweep(): Promise<void> {
    if (!this.enabled()) return;
    await this.runSweep();
  }

  /**
   * The sweep itself — runnable directly (tests, the ops on-demand trigger)
   * without the enabled gate. Logs a one-line summary when it did anything.
   */
  async runSweep(): Promise<ArrivalSweepResult> {
    const result = await this.fulfillment.notifyEstimatedArrivals();
    if (result.notified > 0) {
      this.logger.log(
        `Arrival sweep: ${result.notified} card(s) marked arrived (estimated) + buyer emailed, of ${result.checked} checked`,
      );
    }
    return result;
  }
}
