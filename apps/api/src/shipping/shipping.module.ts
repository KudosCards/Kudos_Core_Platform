import { Module } from "@nestjs/common";
import { royalMailClientProvider, ROYAL_MAIL_CLIENT } from "./royal-mail-client.provider";
import {
  clickAndDropClientProvider,
  CLICK_AND_DROP_CLIENT,
} from "./click-and-drop-client.provider";
import { ClickAndDropService } from "./click-and-drop.service";

/**
 * Provides the two Royal Mail integrations (each real-or-no-op):
 * - the Shipping API client (`ROYAL_MAIL_CLIENT`) — the fulfillment module
 *   injects it to auto-create shipments (labels + tracking). ADR 0072.
 * - the Click & Drop order-import service (`ClickAndDropService`) — payment
 *   paths call it to push each paid card into the operator's Click & Drop
 *   dashboard queue. ADR 0095.
 */
@Module({
  providers: [royalMailClientProvider, clickAndDropClientProvider, ClickAndDropService],
  exports: [ROYAL_MAIL_CLIENT, CLICK_AND_DROP_CLIENT, ClickAndDropService],
})
export class ShippingModule {}
