import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { SavedDesign } from "@prisma/client";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentMembership } from "../auth/current-membership.decorator";
import type { CurrentMembershipContext } from "../auth/types";
import { SavedDesignsService } from "./saved-designs.service";
import { CreateSavedDesignDto } from "./dto/create-saved-design.dto";
import { UpdateSavedDesignDto } from "./dto/update-saved-design.dto";

@ApiTags("saved-designs")
@ApiBearerAuth()
@UseGuards(MembershipGuard)
@Controller("saved-designs")
export class SavedDesignsController {
  constructor(private readonly savedDesignsService: SavedDesignsService) {}

  @Post()
  create(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Body() dto: CreateSavedDesignDto,
  ): Promise<SavedDesign> {
    return this.savedDesignsService.create(membership.accountId, dto);
  }

  @Get()
  list(@CurrentMembership() membership: CurrentMembershipContext): Promise<SavedDesign[]> {
    return this.savedDesignsService.list(membership.accountId);
  }

  @Get(":id")
  findOne(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<SavedDesign> {
    return this.savedDesignsService.findOne(membership.accountId, id);
  }

  @Patch(":id")
  update(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateSavedDesignDto,
  ): Promise<SavedDesign> {
    return this.savedDesignsService.update(membership.accountId, id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.savedDesignsService.remove(membership.accountId, id);
  }
}
