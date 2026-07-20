import { Module } from "@nestjs/common";
import { RecipientsModule } from "../recipients/recipients.module";
import { AuditModule } from "../audit/audit.module";
import { CryptoService } from "../common/crypto.service";
import { IntegrationsController } from "./integrations.controller";
import { ApiKeyService } from "./api-key.service";
import { ApiKeyGuard } from "./api-key.guard";
import { CrmConnectionsService } from "./crm-connections.service";
import { CrmSyncScheduler } from "./crm-sync.scheduler";
import { brevoClientProvider } from "./brevo/brevo-client.provider";
import { hubspotClientProvider } from "./hubspot/hubspot-client.provider";

@Module({
  imports: [RecipientsModule, AuditModule],
  controllers: [IntegrationsController],
  providers: [
    ApiKeyService,
    ApiKeyGuard,
    CryptoService,
    CrmConnectionsService,
    CrmSyncScheduler,
    brevoClientProvider,
    hubspotClientProvider,
  ],
})
export class IntegrationsModule {}
