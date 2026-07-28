import { Module } from "@nestjs/common";
import { EventsController } from "./events.controller";
import { EventsService } from "./events.service";
import { AuditModule } from "../audit/audit.module";
import { SavedDesignsModule } from "../saved-designs/saved-designs.module";
import { BatchOrdersModule } from "../batch-orders/batch-orders.module";

@Module({
  imports: [AuditModule, SavedDesignsModule, BatchOrdersModule],
  controllers: [EventsController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
