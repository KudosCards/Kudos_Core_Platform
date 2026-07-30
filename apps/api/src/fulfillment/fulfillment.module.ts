import { Module } from "@nestjs/common";
import { FulfillmentController } from "./fulfillment.controller";
import { FulfillmentService } from "./fulfillment.service";
import { AuditModule } from "../audit/audit.module";
import { ShippingModule } from "../shipping/shipping.module";

@Module({
  imports: [AuditModule, ShippingModule],
  controllers: [FulfillmentController],
  providers: [FulfillmentService],
})
export class FulfillmentModule {}
