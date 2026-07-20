import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiSecurity, ApiTags } from "@nestjs/swagger";
import type { AccountApiKey } from "@prisma/client";
import type { Request } from "express";
import { MembershipGuard } from "../auth/membership.guard";
import { CurrentMembership } from "../auth/current-membership.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import type { AuthenticatedUser, CurrentMembershipContext } from "../auth/types";
import {
  RecipientsService,
  type IngestResult,
  type NormalizedContact,
} from "../recipients/recipients.service";
import { ApiKeyService } from "./api-key.service";
import { ApiKeyGuard } from "./api-key.guard";
import {
  CrmConnectionsService,
  type CrmConnectionView,
  type CrmSyncResult,
} from "./crm-connections.service";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";
import { ConnectCrmDto } from "./dto/connect-crm.dto";
import { IngestContactsDto } from "./dto/ingest-contacts.dto";
import type { ExternalContactDto } from "./dto/external-contact.dto";

/** Non-secret view of an API key (never includes the hash). */
interface ApiKeyView {
  id: string;
  label: string;
  prefix: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

function toApiKeyView(record: AccountApiKey): ApiKeyView {
  return {
    id: record.id,
    label: record.label,
    prefix: record.prefix,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt,
    createdAt: record.createdAt,
  };
}

/** DTO → the service's normalized shape (parse the date leniently: a bad or
 * missing DOB becomes null rather than failing the whole contact). */
function toNormalized(dto: ExternalContactDto): NormalizedContact {
  const parsedDob = dto.dateOfBirth ? new Date(dto.dateOfBirth) : null;
  return {
    externalId: dto.externalId,
    firstName: dto.firstName,
    lastName: dto.lastName,
    email: dto.email ?? null,
    dateOfBirth: parsedDob && !Number.isNaN(parsedDob.getTime()) ? parsedDob : null,
    addressLine1: dto.addressLine1 ?? null,
    addressLine2: dto.addressLine2 ?? null,
    addressCity: dto.addressCity ?? null,
    addressPostcode: dto.addressPostcode ?? null,
    addressCountry: dto.addressCountry ?? null,
  };
}

@ApiTags("integrations")
@Controller("integrations")
export class IntegrationsController {
  constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly recipients: RecipientsService,
    private readonly crmConnections: CrmConnectionsService,
  ) {}

  // ---- API key management (account holder, Supabase JWT) ----

  @ApiBearerAuth()
  @UseGuards(MembershipGuard)
  @Post("api-keys")
  async createKey(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Body() dto: CreateApiKeyDto,
  ): Promise<ApiKeyView & { key: string }> {
    const { record, plaintext } = await this.apiKeys.create(membership.accountId, dto.label);
    // The one and only time the plaintext key is returned.
    return { ...toApiKeyView(record), key: plaintext };
  }

  @ApiBearerAuth()
  @UseGuards(MembershipGuard)
  @Get("api-keys")
  async listKeys(
    @CurrentMembership() membership: CurrentMembershipContext,
  ): Promise<ApiKeyView[]> {
    const keys = await this.apiKeys.list(membership.accountId);
    return keys.map(toApiKeyView);
  }

  @ApiBearerAuth()
  @UseGuards(MembershipGuard)
  @Delete("api-keys/:id")
  @HttpCode(204)
  async revokeKey(
    @CurrentMembership() membership: CurrentMembershipContext,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.apiKeys.revoke(membership.accountId, id);
  }

  // ---- CRM connections (account holder, Supabase JWT) ----

  @ApiBearerAuth()
  @UseGuards(MembershipGuard)
  @Post("connections")
  connectCrm(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConnectCrmDto,
  ): Promise<CrmConnectionView> {
    return this.crmConnections.connect(
      membership.accountId,
      user.id,
      dto.provider,
      dto.apiKey,
      dto.fieldMapping,
    );
  }

  @ApiBearerAuth()
  @UseGuards(MembershipGuard)
  @Get("connections")
  listCrm(@CurrentMembership() membership: CurrentMembershipContext): Promise<CrmConnectionView[]> {
    return this.crmConnections.list(membership.accountId);
  }

  @ApiBearerAuth()
  @UseGuards(MembershipGuard)
  @Post("connections/:provider/sync")
  syncCrm(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("provider") provider: string,
  ): Promise<CrmSyncResult> {
    return this.crmConnections.sync(membership.accountId, user.id, provider);
  }

  @ApiBearerAuth()
  @UseGuards(MembershipGuard)
  @Delete("connections/:provider")
  @HttpCode(204)
  disconnectCrm(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("provider") provider: string,
  ): Promise<void> {
    return this.crmConnections.disconnect(membership.accountId, user.id, provider);
  }

  // ---- Inbound contact push (external systems, per-account API key) ----

  @ApiSecurity("api-key")
  @Public()
  @UseGuards(ApiKeyGuard)
  @Post("contacts")
  ingest(@Req() request: Request, @Body() dto: IngestContactsDto): Promise<IngestResult> {
    // ApiKeyGuard guarantees request.apiKey is set.
    const { accountId, keyId } = request.apiKey!;
    return this.recipients.ingestFromSource(
      accountId,
      "api",
      dto.contacts.map(toNormalized),
      `api-key:${keyId}`,
    );
  }
}
