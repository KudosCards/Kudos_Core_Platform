import { Global, Module } from "@nestjs/common";
import { marketingContactsClientProvider } from "./marketing-contacts.provider";
import { MarketingContactsService } from "./marketing-contacts.service";
import { MARKETING_CONTACTS_CLIENT } from "./marketing-contacts.client";

/**
 * Global so signup (and any future producer) can inject MarketingContactsService
 * without re-wiring the provider — mirrors the EmailModule pattern.
 */
@Global()
@Module({
  providers: [marketingContactsClientProvider, MarketingContactsService],
  exports: [MarketingContactsService, MARKETING_CONTACTS_CLIENT],
})
export class MarketingModule {}
