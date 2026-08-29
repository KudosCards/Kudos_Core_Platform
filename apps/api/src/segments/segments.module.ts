import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { SegmentsService } from "./segments.service";
import { SegmentsController } from "./segments.controller";

@Module({
  imports: [AuditModule, EntitlementsModule],
  controllers: [SegmentsController],
  providers: [SegmentsService],
})
export class SegmentsModule {}
