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
import type { MessagePageDetail, MessagePageSummary } from "@kudos/shared-types";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentMembership } from "../auth/current-membership.decorator";
import type { CurrentMembershipContext } from "../auth/types";
import { MessagePagesService } from "./message-pages.service";
import { CreateMessagePageDto } from "./dto/create-message-page.dto";
import { UpdateMessagePageDto } from "./dto/update-message-page.dto";

/**
 * The account-owned Message Pages library (ADR 0132). All authed + account-scoped
 * via MembershipGuard. Authoring (create/update) is gated to paid plans in the
 * service; reads stay open so a downgraded account keeps sight of its pages. The
 * public QR read lives on the separate `messages` controller.
 */
@ApiTags("message-pages")
@ApiBearerAuth()
@UseGuards(MembershipGuard)
@Controller("message-pages")
export class MessagePagesController {
  constructor(private readonly messagePages: MessagePagesService) {}

  @Post()
  create(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Body() dto: CreateMessagePageDto,
  ): Promise<MessagePageDetail> {
    return this.messagePages.create(membership.accountId, membership.userId, dto);
  }

  @Get()
  list(
    @CurrentMembership() membership: CurrentMembershipContext,
  ): Promise<MessagePageSummary[]> {
    return this.messagePages.list(membership.accountId);
  }

  @Get(":id")
  get(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<MessagePageDetail> {
    return this.messagePages.get(membership.accountId, id);
  }

  @Patch(":id")
  update(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateMessagePageDto,
  ): Promise<MessagePageDetail> {
    return this.messagePages.update(membership.accountId, id, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  archive(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.messagePages.archive(membership.accountId, id);
  }
}
