import { Module } from "@nestjs/common";
import { StorageController } from "./storage.controller";
import { StorageService } from "./storage.service";
import { designAssetStorageProvider } from "./design-asset-storage.provider";

@Module({
  controllers: [StorageController],
  providers: [StorageService, designAssetStorageProvider],
  exports: [StorageService],
})
export class StorageModule {}
