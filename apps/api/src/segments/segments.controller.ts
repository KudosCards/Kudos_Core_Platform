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
import type { SegmentSummary, SegmentsOverview } from "@kudos/shared-types";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentMembership } from "../auth/current-membership.decorator";
import type { CurrentMembershipContext } from "../auth/types";
import { SegmentsService } from "./segments.service";
import { CreateSegmentDto } from "./dto/create-segment.dto";

/**
 * Segments (smart lists): live-resolving saved filters over the contact book.
 * The overview returns suggested presets + saved segments each already resolved
 * to a count + preview. See docs/adr/0105-segments-smart-lists.md.
 */
@ApiTags("segments")
@ApiBearerAuth()
@UseGuards(MembershipGuard)
@Controller("segments")
export class SegmentsController {
  constructor(private readonly segments: SegmentsService) {}

  @Get()
  overview(@CurrentMembership() membership: CurrentMembershipContext): Promise<SegmentsOverview> {
    return this.segments.overview(membership.accountId);
  }

  @Post()
  create(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Body() dto: CreateSegmentDto,
  ): Promise<SegmentSummary> {
    return this.segments.create(membership.accountId, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.segments.remove(membership.accountId, id);
  }
}
