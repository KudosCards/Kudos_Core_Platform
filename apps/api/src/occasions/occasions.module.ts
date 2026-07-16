import { Module } from "@nestjs/common";
import { OccasionsController } from "./occasions.controller";
import { OccasionsService } from "./occasions.service";
import { OccasionSchedulerService } from "./occasion-scheduler.service";
import { AuditModule } from "../audit/audit.module";
import { SavedDesignsModule } from "../saved-designs/saved-designs.module";

@Module({
  imports: [AuditModule, SavedDesignsModule],
  controllers: [OccasionsController],
  providers: [OccasionsService, OccasionSchedulerService],
  exports: [OccasionsService],
})
export class OccasionsModule {}
