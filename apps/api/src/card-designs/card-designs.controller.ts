import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { ApiTags } from "@nestjs/swagger";
import type { CardDesign } from "@prisma/client";
import { Public } from "../auth/public.decorator";
import { CardDesignsService } from "./card-designs.service";
import { ListCardDesignsQueryDto } from "./dto/list-card-designs-query.dto";

/**
 * The card catalog is public: it's the marketing card library an unauthenticated
 * visitor browses before signing up ("pick a card → personalise → sign up", see
 * docs/adr/0017-public-card-library.md). Only active templates are returned
 * (the service filters isActive), and templates carry no account data.
 *
 * Rate-limited per IP: these are the only unauthenticated reads in the app, so
 * they carry no per-account throttle key — the per-IP ThrottlerGuard keeps a
 * scraper or a hot loop from hammering the catalog. The limit is generous
 * because a genuine gallery browse fires several requests in quick succession.
 */
@ApiTags("card-designs")
@Controller("card-designs")
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
export class CardDesignsController {
  constructor(private readonly cardDesignsService: CardDesignsService) {}

  @Public()
  @Get()
  list(@Query() query: ListCardDesignsQueryDto): Promise<CardDesign[]> {
    return this.cardDesignsService.list(query);
  }

  @Public()
  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<CardDesign> {
    return this.cardDesignsService.findOne(id);
  }
}
