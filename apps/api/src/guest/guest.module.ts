import { Module } from "@nestjs/common";
import { CardDesignsModule } from "../card-designs/card-designs.module";
import { SavedDesignsModule } from "../saved-designs/saved-designs.module";
import { BatchOrdersModule } from "../batch-orders/batch-orders.module";
import { GuestController } from "./guest.controller";
import { GuestOrdersService } from "./guest-orders.service";
import { GuestClaimService } from "./guest-claim.service";

@Module({
  // Rate limiting is configured once, globally, in AppModule; the public guest
  // routes opt in per-route via @UseGuards(ThrottlerGuard) + @Throttle.
  imports: [CardDesignsModule, SavedDesignsModule, BatchOrdersModule],
  controllers: [GuestController],
  providers: [GuestOrdersService, GuestClaimService],
})
export class GuestModule {}
