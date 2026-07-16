import { Controller, Get, Param, ParseUUIDPipe, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { CardDesign } from "@prisma/client";
import { CardDesignsService } from "./card-designs.service";
import { ListCardDesignsQueryDto } from "./dto/list-card-designs-query.dto";

@ApiTags("card-designs")
@ApiBearerAuth()
@Controller("card-designs")
export class CardDesignsController {
  constructor(private readonly cardDesignsService: CardDesignsService) {}

  @Get()
  list(@Query() query: ListCardDesignsQueryDto): Promise<CardDesign[]> {
    return this.cardDesignsService.list(query);
  }

  @Get(":id")
  findOne(@Param("id", ParseUUIDPipe) id: string): Promise<CardDesign> {
    return this.cardDesignsService.findOne(id);
  }
}
