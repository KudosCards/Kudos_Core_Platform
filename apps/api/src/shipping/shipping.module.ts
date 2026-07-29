import { Module } from "@nestjs/common";
import { royalMailClientProvider, ROYAL_MAIL_CLIENT } from "./royal-mail-client.provider";

/**
 * Provides the Royal Mail Shipping client (real or no-op) for other modules —
 * the fulfillment module injects it to auto-create shipments. See
 * docs/adr/0072-royal-mail-shipping.md.
 */
@Module({
  providers: [royalMailClientProvider],
  exports: [ROYAL_MAIL_CLIENT],
})
export class ShippingModule {}
