import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ROYAL_MAIL_CLIENT } from "../shipping/royal-mail-client.provider";
import type { RoyalMailClient } from "../shipping/royal-mail-client";
import { FulfillmentService, type DeliveryPollResult } from "./fulfillment.service";

/**
 * The automated delivery-registration loop (ADR 0121): a standing sweep that
 * closes the last manual step in fulfillment. Cards posted via Royal Mail carry
 * a tracking number but, until now, only reached `delivered` when an operator
 * clicked each one. This polls the carrier and advances them itself.
 *
 * The cron only fires the real sweep when Royal Mail shipping is configured;
 * with no key it's a no-op (ops keep marking delivered manually, exactly as
 * before). The state-machine work lives in FulfillmentService — this class is
 * only the schedule + the enabled gate, mirroring DispatchReminderService.
 */
@Injectable()
export class DeliveryPollService {
  private readonly logger = new Logger(DeliveryPollService.name);

  constructor(
    private readonly fulfillment: FulfillmentService,
    @Inject(ROYAL_MAIL_CLIENT) private readonly royalMail: RoyalMailClient,
  ) {}

  /**
   * Hourly, offset from the top of the hour so it doesn't pile onto the other
   * fulfillment crons. Skips entirely when shipping automation is off (no
   * carrier to ask). Royal Mail tracking updates through the day; hourly keeps
   * `delivered` fresh without hammering the API.
   */
  // No timezone: an hour is an hour everywhere, so pinning one here would
  // imply a decision about wall-clock time that isn't being made.
  @Cron("35 * * * *")
  async scheduledPoll(): Promise<void> {
    if (!this.royalMail.enabled) return;
    await this.runPoll();
  }

  /**
   * The sweep itself — runnable directly (tests, the ops on-demand trigger)
   * without the cron's schedule. Logs a one-line summary when it did anything.
   */
  async runPoll(): Promise<DeliveryPollResult> {
    const result = await this.fulfillment.pollCarrierDeliveries();
    if (result.delivered > 0 || result.failed > 0) {
      this.logger.log(
        `Delivery poll: ${result.delivered} delivered / ${result.failed} failed of ${result.checked} checked`,
      );
    }
    return result;
  }
}
