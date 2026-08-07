import { Module } from "@nestjs/common";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { MessagePagesController } from "./message-pages.controller";
import { MessagePagesService } from "./message-pages.service";

@Module({
  imports: [EntitlementsModule],
  controllers: [MessagePagesController],
  providers: [MessagePagesService],
  exports: [MessagePagesService],
})
export class MessagePagesModule {}
