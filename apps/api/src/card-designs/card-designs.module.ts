import { Module } from "@nestjs/common";
import { CardDesignsController } from "./card-designs.controller";
import { CardDesignsService } from "./card-designs.service";

@Module({
  controllers: [CardDesignsController],
  providers: [CardDesignsService],
  exports: [CardDesignsService],
})
export class CardDesignsModule {}
