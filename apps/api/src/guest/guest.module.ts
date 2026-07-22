import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { CardDesignsModule } from "../card-designs/card-designs.module";
import { SavedDesignsModule } from "../saved-designs/saved-designs.module";
import { BatchOrdersModule } from "../batch-orders/batch-orders.module";
import { GuestController } from "./guest.controller";
import { GuestOrdersService } from "./guest-orders.service";

@Module({
  // Throttling is scoped to this module (mirroring MessagesModule) so it applies
  // only to the public guest routes that opt in via @UseGuards(ThrottlerGuard).
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
    CardDesignsModule,
    SavedDesignsModule,
    BatchOrdersModule,
  ],
  controllers: [GuestController],
  providers: [GuestOrdersService],
})
export class GuestModule {}
