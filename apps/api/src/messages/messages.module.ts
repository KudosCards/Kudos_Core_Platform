import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { MessagesController } from "./messages.controller";
import { MessagesService } from "./messages.service";

@Module({
  // Configured here rather than globally so rate limiting applies only to the
  // routes that opt in via @UseGuards(ThrottlerGuard) — every other endpoint
  // in the API is gated by auth, not throttling, and shouldn't change.
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }])],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
