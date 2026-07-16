import { Module } from "@nestjs/common";
import { SavedDesignsController } from "./saved-designs.controller";
import { SavedDesignsService } from "./saved-designs.service";
import { CardDesignsModule } from "../card-designs/card-designs.module";

@Module({
  imports: [CardDesignsModule],
  controllers: [SavedDesignsController],
  providers: [SavedDesignsService],
  exports: [SavedDesignsService],
})
export class SavedDesignsModule {}
