import { Module } from "@nestjs/common";
import { SavedDesignsController } from "./saved-designs.controller";
import { SavedDesignsService } from "./saved-designs.service";
import { ArtworkGateService } from "./artwork-gate.service";
import { CardDesignsModule } from "../card-designs/card-designs.module";
import { EntitlementsModule } from "../entitlements/entitlements.module";

@Module({
  imports: [CardDesignsModule, EntitlementsModule],
  controllers: [SavedDesignsController],
  providers: [SavedDesignsService, ArtworkGateService],
  exports: [SavedDesignsService],
})
export class SavedDesignsModule {}
