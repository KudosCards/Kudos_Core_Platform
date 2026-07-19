import { Module } from "@nestjs/common";
import { RecipientsModule } from "../recipients/recipients.module";
import { IntegrationsController } from "./integrations.controller";
import { ApiKeyService } from "./api-key.service";
import { ApiKeyGuard } from "./api-key.guard";

@Module({
  imports: [RecipientsModule],
  controllers: [IntegrationsController],
  providers: [ApiKeyService, ApiKeyGuard],
})
export class IntegrationsModule {}
