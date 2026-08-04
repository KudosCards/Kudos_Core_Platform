import { Module } from "@nestjs/common";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { SegmentsService } from "./segments.service";
import { SegmentsController } from "./segments.controller";

@Module({
  imports: [EntitlementsModule],
  controllers: [SegmentsController],
  providers: [SegmentsService],
})
export class SegmentsModule {}
