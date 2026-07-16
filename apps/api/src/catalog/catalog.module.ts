import { Module } from "@nestjs/common";
import { designAssetStorageProvider } from "../storage/design-asset-storage.provider";
import { CatalogController } from "./catalog.controller";
import { CatalogSyncService } from "./catalog-sync.service";
import { CatalogSyncSchedulerService } from "./catalog-sync-scheduler.service";
import { catalogSourceProvider } from "./catalog-source.provider";

/**
 * Airtable-sourced card catalog. PlatformAdminGuard is available app-wide
 * (AuthModule is @Global), so the ops-only controller needs no extra import.
 * The Supabase storage client is re-provided here (a pure factory) so the sync
 * can copy Airtable artwork into our own bucket.
 */
@Module({
  controllers: [CatalogController],
  providers: [
    catalogSourceProvider,
    designAssetStorageProvider,
    CatalogSyncService,
    CatalogSyncSchedulerService,
  ],
  exports: [CatalogSyncService],
})
export class CatalogModule {}
