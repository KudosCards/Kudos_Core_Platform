import { Module } from "@nestjs/common";
import { DesignAssetsController } from "./design-assets.controller";
import { DesignAssetsService } from "./design-assets.service";

@Module({
  controllers: [DesignAssetsController],
  providers: [DesignAssetsService],
  exports: [DesignAssetsService],
})
export class DesignAssetsModule {}
