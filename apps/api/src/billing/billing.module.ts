import { Module } from "@nestjs/common";
import { STRIPE_CLIENT, stripeClientProvider } from "./stripe-client.provider";

@Module({
  providers: [stripeClientProvider],
  exports: [STRIPE_CLIENT],
})
export class BillingModule {}
