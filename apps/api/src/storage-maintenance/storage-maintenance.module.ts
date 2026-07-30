import { Module } from "@nestjs/common";
import { designAssetStorageProvider } from "../storage/design-asset-storage.provider";
import { StorageMaintenanceController } from "./storage-maintenance.controller";
import { StorageReaperSchedulerService } from "./storage-reaper-scheduler.service";
import { StorageReaperService } from "./storage-reaper.service";

/**
 * Storage janitor: reclaims orphaned artwork from the design-assets bucket.
 * PlatformAdminGuard is available app-wide (AuthModule is @Global), so the
 * ops-only controller needs no extra import. The Supabase storage client is
 * re-provided here (a pure factory, same as CatalogModule) so the reaper can
 * list and delete objects. See docs/adr/0074-orphaned-asset-reaper.md.
 */
@Module({
  controllers: [StorageMaintenanceController],
  providers: [designAssetStorageProvider, StorageReaperService, StorageReaperSchedulerService],
  exports: [StorageReaperService],
})
export class StorageMaintenanceModule {}
