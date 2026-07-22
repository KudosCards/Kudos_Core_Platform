import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
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
 */
@ApiTags("card-designs")
@Controller("card-designs")
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
