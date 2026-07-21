import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { LoggerModule } from "nestjs-pino";
import { validateEnv } from "./config/env.schema";
import { PrismaModule } from "./prisma/prisma.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { AccountsModule } from "./accounts/accounts.module";
import { RecipientsModule } from "./recipients/recipients.module";
import { RecipientListsModule } from "./recipient-lists/recipient-lists.module";
import { CardDesignsModule } from "./card-designs/card-designs.module";
import { SavedDesignsModule } from "./saved-designs/saved-designs.module";
import { StorageModule } from "./storage/storage.module";
import { OccasionsModule } from "./occasions/occasions.module";
import { BillingModule } from "./billing/billing.module";
import { BatchOrdersModule } from "./batch-orders/batch-orders.module";
import { WebhooksModule } from "./webhooks/webhooks.module";
import { SubscriptionsModule } from "./subscriptions/subscriptions.module";
import { MessagesModule } from "./messages/messages.module";
import { FulfillmentModule } from "./fulfillment/fulfillment.module";
import { AdminModule } from "./admin/admin.module";
import { CatalogModule } from "./catalog/catalog.module";
import { WalletModule } from "./wallet/wallet.module";
import { AutoSendModule } from "./auto-send/auto-send.module";
import { IntegrationsModule } from "./integrations/integrations.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ScheduleModule.forRoot(),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === "production" ? "info" : "debug",
        transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
        redact: ["req.headers.authorization", 'req.headers["x-api-key"]'],
      },
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    AccountsModule,
    RecipientsModule,
    RecipientListsModule,
    CardDesignsModule,
    SavedDesignsModule,
    StorageModule,
    OccasionsModule,
    BillingModule,
    BatchOrdersModule,
    WebhooksModule,
    SubscriptionsModule,
    MessagesModule,
    FulfillmentModule,
    AdminModule,
    CatalogModule,
    WalletModule,
    AutoSendModule,
    IntegrationsModule,
  ],
})
export class AppModule {}
