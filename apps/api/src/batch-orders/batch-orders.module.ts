import { Module } from "@nestjs/common";
import { BatchOrdersController } from "./batch-orders.controller";
import { BatchOrdersService } from "./batch-orders.service";
import { AuditModule } from "../audit/audit.module";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { BillingModule } from "../billing/billing.module";
import { MessagesModule } from "../messages/messages.module";
import { RecipientsModule } from "../recipients/recipients.module";
import { OpsActivityModule } from "../ops-activity/ops-activity.module";

@Module({
  imports: [
    AuditModule,
    EntitlementsModule,
    BillingModule,
    MessagesModule,
    RecipientsModule,
    // A full-wallet checkout settles the order here rather than through Stripe,
    // so this is the only place that can tell Kudos HQ about it.
    OpsActivityModule,
  ],
  controllers: [BatchOrdersController],
  providers: [BatchOrdersService],
  exports: [BatchOrdersService],
})
export class BatchOrdersModule {}
