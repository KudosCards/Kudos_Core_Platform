import { Module } from "@nestjs/common";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { PricingController } from "./pricing.controller";

@Module({
  imports: [EntitlementsModule],
  controllers: [PricingController],
})
export class PricingModule {}
