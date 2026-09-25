import { Global, Module } from "@nestjs/common";
import { EmailSuppressionModule } from "../email-suppression/email-suppression.module";
import { emailClientProvider } from "./email-client.provider";
import { EMAIL_CLIENT } from "./email.client";

/**
 * Global so any feature (reminders, guest receipts) can inject EMAIL_CLIENT
 * without re-wiring the provider. See docs/adr/0025.
 */
@Global()
@Module({
  imports: [EmailSuppressionModule],
  providers: [emailClientProvider],
  exports: [EMAIL_CLIENT],
})
export class EmailModule {}
