import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { DesignAsset } from "@kudos/shared-types";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentMembership } from "../auth/current-membership.decorator";
import type { CurrentMembershipContext } from "../auth/types";
import { DesignAssetsService } from "./design-assets.service";
import { CreateDesignAssetDto } from "./dto/create-design-asset.dto";

/**
 * The designer's reusable-image library ("Your uploads"). Every route is
 * account-scoped via MembershipGuard. See docs/adr/0070-saved-assets-library.md.
 */
@ApiTags("design-assets")
@ApiBearerAuth()
@UseGuards(MembershipGuard)
@Controller("design-assets")
export class DesignAssetsController {
  constructor(private readonly service: DesignAssetsService) {}

  @Get()
  list(@CurrentMembership() membership: CurrentMembershipContext): Promise<DesignAsset[]> {
    return this.service.list(membership.accountId);
  }

  @Post()
  create(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Body() dto: CreateDesignAssetDto,
  ): Promise<DesignAsset> {
    return this.service.create(membership.accountId, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.remove(membership.accountId, id);
  }
}
