import { Module } from "@nestjs/common";
import { SegmentsService } from "./segments.service";
import { SegmentsController } from "./segments.controller";

@Module({
  controllers: [SegmentsController],
  providers: [SegmentsService],
})
export class SegmentsModule {}
