import { Module } from "@nestjs/common";
import { BrevoWebhookController } from "./brevo-webhook.controller";
import { EmailSuppressionService } from "./email-suppression.service";

/**
 * Kept apart from `WebhooksModule` — which is Stripe, billing, wallet and batch
 * orders — even though both answer under `/webhooks`. Nothing about recording a
 * bounce should be able to break payments.
 */
@Module({
  controllers: [BrevoWebhookController],
  providers: [EmailSuppressionService],
  // Exported so the senders (E2) can tell when an address is unreachable
  // instead of reporting a send that Brevo will drop.
  exports: [EmailSuppressionService],
})
export class EmailSuppressionModule {}
