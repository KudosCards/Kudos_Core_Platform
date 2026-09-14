import { Module } from "@nestjs/common";
import { BillingModule } from "../billing/billing.module";
import { designAssetStorageProvider } from "../storage/design-asset-storage.provider";
import { CatalogController } from "./catalog.controller";
import { CatalogSyncService } from "./catalog-sync.service";
import { CatalogPublisherService } from "./catalog-publisher.service";
import { CatalogSyncSchedulerService } from "./catalog-sync-scheduler.service";
import { catalogSourceProvider } from "./catalog-source.provider";
import { CatalogCropGateService } from "./catalog-crop-gate.service";

/**
 * Airtable-sourced card catalog. PlatformAdminGuard is available app-wide
 * (AuthModule is @Global), so the ops-only controller needs no extra import.
 * The Supabase storage client is re-provided here (a pure factory) so the sync
 * can copy Airtable artwork into our own bucket.
 */
@Module({
  // BillingModule for PlatformSettingsService: the crop gate is a runtime
  // setting, so it can be switched on the day the catalog is re-exported.
  imports: [BillingModule],
  controllers: [CatalogController],
  providers: [
    catalogSourceProvider,
    designAssetStorageProvider,
    CatalogSyncService,
    CatalogPublisherService,
    CatalogSyncSchedulerService,
    CatalogCropGateService,
  ],
  exports: [CatalogSyncService, CatalogCropGateService],
})
export class CatalogModule {}
