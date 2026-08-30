import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { validateEnv } from "./config/env.schema";
import { loggerOptions } from "./common/logger.options";
import { PrismaModule } from "./prisma/prisma.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { AccountsModule } from "./accounts/accounts.module";
import { RecipientsModule } from "./recipients/recipients.module";
import { RecipientListsModule } from "./recipient-lists/recipient-lists.module";
import { CardDesignsModule } from "./card-designs/card-designs.module";
import { SavedDesignsModule } from "./saved-designs/saved-designs.module";
import { DesignAssetsModule } from "./design-assets/design-assets.module";
import { StorageModule } from "./storage/storage.module";
import { OccasionsModule } from "./occasions/occasions.module";
import { EventsModule } from "./events/events.module";
import { BillingModule } from "./billing/billing.module";
import { BatchOrdersModule } from "./batch-orders/batch-orders.module";
import { WebhooksModule } from "./webhooks/webhooks.module";
import { SubscriptionsModule } from "./subscriptions/subscriptions.module";
import { MessagesModule } from "./messages/messages.module";
import { MessagePagesModule } from "./message-pages/message-pages.module";
import { FulfillmentModule } from "./fulfillment/fulfillment.module";
import { AdminModule } from "./admin/admin.module";
import { DispatchModule } from "./dispatch/dispatch.module";
import { PricingModule } from "./pricing/pricing.module";
import { CatalogModule } from "./catalog/catalog.module";
import { WalletModule } from "./wallet/wallet.module";
import { AutoSendModule } from "./auto-send/auto-send.module";
import { OpsActivityModule } from "./ops-activity/ops-activity.module";
import { IntegrationsModule } from "./integrations/integrations.module";
import { GuestModule } from "./guest/guest.module";
import { EmailModule } from "./email/email.module";
import { MarketingModule } from "./marketing/marketing.module";
import { RemindersModule } from "./reminders/reminders.module";
import { TeamModule } from "./team/team.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { ReturnsModule } from "./returns/returns.module";
import { SupportModule } from "./support/support.module";
import { EnterpriseModule } from "./enterprise/enterprise.module";
import { SegmentsModule } from "./segments/segments.module";
import { SupabaseAdminModule } from "./supabase/supabase-admin.module";
import { StorageMaintenanceModule } from "./storage-maintenance/storage-maintenance.module";
import { PlatformNotificationsModule } from "./platform-notifications/platform-notifications.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ScheduleModule.forRoot(),
    // One central rate-limiting registration for the whole app. ThrottlerModule
    // is global, so a single forRoot here backs every `@UseGuards(ThrottlerGuard)`
    // route — the public message-page, guest-order, returns, invites and
    // enterprise-enquiry endpoints. Previously two modules (messages, guest)
    // each called forRoot, so there were two competing global registrations and
    // three other controllers silently relied on that side effect; whichever
    // module initialised last won the shared storage/config. Centralising it
    // removes that drift. Each route still sets its own limit via @Throttle, so
    // this default is only a backstop. The default in-memory store is correct
    // for a single instance; to keep limits accurate across multiple instances,
    // swap in a shared store here (e.g. Redis) — see ADR 0133.
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 30 }]),
    LoggerModule.forRoot(loggerOptions()),
    PrismaModule,
    HealthModule,
    AuthModule,
    AccountsModule,
    RecipientsModule,
    RecipientListsModule,
    CardDesignsModule,
    SavedDesignsModule,
    DesignAssetsModule,
    StorageModule,
    OccasionsModule,
    EventsModule,
    BillingModule,
    BatchOrdersModule,
    WebhooksModule,
    SubscriptionsModule,
    MessagesModule,
    MessagePagesModule,
    FulfillmentModule,
    AdminModule,
    DispatchModule,
    PricingModule,
    CatalogModule,
    WalletModule,
    AutoSendModule,
    OpsActivityModule,
    IntegrationsModule,
    GuestModule,
    EmailModule,
    MarketingModule,
    RemindersModule,
    TeamModule,
    NotificationsModule,
    ReturnsModule,
    SupportModule,
    EnterpriseModule,
    SegmentsModule,
    SupabaseAdminModule,
    StorageMaintenanceModule,
    PlatformNotificationsModule,
  ],
})
export class AppModule {}
