import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import type { Recipient, RecipientKeyDate } from "@prisma/client";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { CurrentMembership } from "../auth/current-membership.decorator";
import type { AuthenticatedUser, CurrentMembershipContext } from "../auth/types";
import { RecipientsService, type ImportSummary, type Paginated } from "./recipients.service";
import { CreateRecipientDto } from "./dto/create-recipient.dto";
import { UpdateRecipientDto } from "./dto/update-recipient.dto";
import { ListRecipientsQueryDto } from "./dto/list-recipients-query.dto";
import { UpsertKeyDateDto } from "./dto/upsert-key-date.dto";
import {
  csvColumnMappingSchema,
  type CsvColumnMapping,
  type CsvImportPreview,
} from "@kudos/shared-types";

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

  // Recurring key dates (renewal / anniversary). See docs/adr/0104.

  @Get(":id/key-dates")
  listKeyDates(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<RecipientKeyDate[]> {
    return this.recipientsService.listKeyDates(membership.accountId, id);
  }

  @Put(":id/key-dates/:type")
  upsertKeyDate(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("type") type: string,
    @Body() dto: UpsertKeyDateDto,
  ): Promise<RecipientKeyDate> {
    return this.recipientsService.upsertKeyDate(membership.accountId, user.id, id, type, dto);
  }

  @Delete(":id/key-dates/:type")
  @HttpCode(204)
  deleteKeyDate(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("type") type: string,
  ): Promise<void> {
    return this.recipientsService.deleteKeyDate(membership.accountId, user.id, id, type);
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
    // Optional column mapping (JSON string in the multipart form) so the
    // uploaded CSV's own headers can be mapped onto our fields. Omitted → the
    // file must already use our canonical headers (the legacy contract).
    @Body("mapping") mappingRaw?: string,
  ): Promise<ImportSummary> {
    if (!file) {
      throw new BadRequestException("A CSV file is required");
    }
    const mapping = this.parseMapping(mappingRaw);
    return this.recipientsService.importCsv(membership.accountId, user.id, file.buffer, mapping);
  }

  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  @Post("import/preview")
  previewImport(@UploadedFile() file?: Express.Multer.File): CsvImportPreview {
    if (!file) {
      throw new BadRequestException("A CSV file is required");
    }
    return this.recipientsService.previewImport(file.buffer);
  }

  /** Parse + validate the optional mapping form field, turning bad JSON or a
   * malformed shape into a clean 400 rather than a 500. */
  private parseMapping(raw?: string): CsvColumnMapping | undefined {
    if (!raw) return undefined;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new BadRequestException("mapping must be valid JSON");
    }
    const result = csvColumnMappingSchema.safeParse(json);
    if (!result.success) {
      throw new BadRequestException("mapping has an invalid shape");
    }
    return result.data;
  }
}
