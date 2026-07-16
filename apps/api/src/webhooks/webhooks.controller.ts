import type { RawBodyRequest } from "@nestjs/common";
import { BadRequestException, Controller, Headers, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../auth/public.decorator";
import { WebhooksService } from "./webhooks.service";

@Controller("webhooks")
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Public()
  @Post("stripe")
  async handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers("stripe-signature") signature?: string,
  ): Promise<{ received: true }> {
    if (!req.rawBody || !signature) {
      throw new BadRequestException("Missing Stripe signature or request body");
    }
    await this.webhooksService.handleEvent(req.rawBody, signature);
    return { received: true };
  }
}
