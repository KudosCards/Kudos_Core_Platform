import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import type { Recipient } from "@prisma/client";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentMembership } from "../auth/current-membership.decorator";
import type { AuthenticatedUser, CurrentMembershipContext } from "../auth/types";
import { RecipientsService, type ImportSummary, type Paginated } from "./recipients.service";
import { CreateRecipientDto } from "./dto/create-recipient.dto";
import { UpdateRecipientDto } from "./dto/update-recipient.dto";
import { ListRecipientsQueryDto } from "./dto/list-recipients-query.dto";

@ApiTags("recipients")
@ApiBearerAuth()
@UseGuards(MembershipGuard)
@Controller("recipients")
export class RecipientsController {
  constructor(private readonly recipientsService: RecipientsService) {}

  @Post()
  create(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRecipientDto,
  ): Promise<Recipient> {
    return this.recipientsService.create(membership.accountId, user.id, dto);
  }

  @Get()
  list(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListRecipientsQueryDto,
  ): Promise<Paginated<Recipient>> {
    return this.recipientsService.list(membership.accountId, user.id, query);
  }

  @Get(":id")
  findOne(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<Recipient> {
    return this.recipientsService.findOne(membership.accountId, user.id, id);
  }

  @Patch(":id")
  update(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateRecipientDto,
  ): Promise<Recipient> {
    return this.recipientsService.update(membership.accountId, user.id, id, dto);
  }

  @Delete(":id")
  archive(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<Recipient> {
    return this.recipientsService.archive(membership.accountId, user.id, id);
  }

  @ApiConsumes("multipart/form-data")
  // Bound the upload: the whole file is buffered in memory and parsed before
  // the per-plan recipient cap is even consulted, so without a limit a single
  // large upload could exhaust the API's memory. 5 MB is ~50k CSV rows — far
  // above any plan's recipientCap (50–200), so no legitimate import hits it.
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  @Post("import")
  importCsv(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<ImportSummary> {
    if (!file) {
      throw new BadRequestException("A CSV file is required");
    }
    return this.recipientsService.importCsv(membership.accountId, user.id, file.buffer);
  }
}
