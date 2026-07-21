import { Module } from "@nestjs/common";
import { RecipientListsController } from "./recipient-lists.controller";
import { RecipientListsService } from "./recipient-lists.service";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuditModule],
  controllers: [RecipientListsController],
  providers: [RecipientListsService],
  exports: [RecipientListsService],
})
export class RecipientListsModule {}
