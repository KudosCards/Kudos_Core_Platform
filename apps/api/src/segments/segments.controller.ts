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
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { SegmentPreview, SegmentSummary, SegmentsOverview } from "@kudos/shared-types";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentMembership } from "../auth/current-membership.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser, CurrentMembershipContext } from "../auth/types";
import { SegmentsService, type SegmentMembersResult } from "./segments.service";
import { CreateSegmentDto } from "./dto/create-segment.dto";
import { PreviewSegmentDto } from "./dto/preview-segment.dto";
import { UpdateSegmentDto } from "./dto/update-segment.dto";

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

  /**
   * A segment (by preset key or saved id) resolved to its full member recipients,
   * capped at the plan's per-order limit — seeds the bulk-send composer's "Send
   * to this list". 404 if neither a preset nor a saved segment matches.
   */
  @Get("members")
  members(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Query("segment") segment: string,
  ): Promise<SegmentMembersResult> {
    return this.segments.membersForKey(membership.accountId, segment);
  }

  /**
   * Resolve an unsaved rule to a live count + sample, so the builder can show
   * what a rule catches before anyone commits to it. Declared above `:id` —
   * "preview" is a literal path that would otherwise be read as an id.
   */
  @Post("preview")
  @HttpCode(200)
  preview(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Body() dto: PreviewSegmentDto,
  ): Promise<SegmentPreview> {
    return this.segments.preview(membership.accountId, dto);
  }

  @Post()
  create(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSegmentDto,
  ): Promise<SegmentSummary> {
    return this.segments.create(membership.accountId, user.id, dto);
  }

  /** Rename a saved segment, change its rule, or both. */
  @Patch(":id")
  update(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateSegmentDto,
  ): Promise<SegmentSummary> {
    return this.segments.update(membership.accountId, user.id, id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.segments.remove(membership.accountId, user.id, id);
  }
}
