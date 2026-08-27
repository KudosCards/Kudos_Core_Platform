import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { ApiBearerAuth, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import type { AccountApiKey } from "@prisma/client";
import type { Request, Response } from "express";
import type { EnvConfig } from "../config/env.schema";
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
import { ApiKeyThrottlerGuard } from "./api-key-throttler.guard";
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

/**
 * URL-facing OAuth callback slug → our internal provider key.
 *
 * GoHighLevel's Marketplace enforces a white-label policy that rejects any
 * registered redirect URL containing "highlevel"/"gohighlevel" — so our natural
 * `…/oauth/gohighlevel/callback` path can't be saved there. GHL's own docs use
 * the neutral name "leadconnector" (their token host is leadconnectorhq.com),
 * so the app registers `…/oauth/leadconnector/callback` and we map that slug
 * back to the `gohighlevel` provider on the way in. Everything else — the DB
 * `provider` value, the GOHIGHLEVEL_* env vars, the web connector — is unchanged.
 * See docs/adr/0156.
 */
const OAUTH_CALLBACK_SLUG_ALIASES: Record<string, string> = { leadconnector: "gohighlevel" };

@ApiTags("integrations")
@Controller("integrations")
export class IntegrationsController {
  private readonly logger = new Logger(IntegrationsController.name);

  constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly recipients: RecipientsService,
    private readonly crmConnections: CrmConnectionsService,
    private readonly config: ConfigService<EnvConfig, true>,
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
  async listKeys(@CurrentMembership() membership: CurrentMembershipContext): Promise<ApiKeyView[]> {
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

  // ---- OAuth connect (HubSpot, account holder + provider redirect) ----

  /** Returns the provider's consent URL for the browser to redirect to. The
   * signed state ties the eventual callback back to this account. */
  @ApiBearerAuth()
  @UseGuards(MembershipGuard)
  @Get("oauth/:provider/start")
  startOAuth(
    @CurrentMembership() membership: CurrentMembershipContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param("provider") provider: string,
  ): { url: string } {
    return this.crmConnections.startOAuth(membership.accountId, user.id, provider);
  }

  /** The provider redirects the browser here after consent. Public (no JWT — the
   * signed `state` is what we trust). Always ends in a redirect back to the web
   * app's Integrations page, flagged success or error. Throttled per IP: it's an
   * unauthenticated endpoint, and while the signed state is the real guard, a
   * rate limit stops it from being hammered with forged callbacks. */
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get("oauth/:provider/callback")
  async oauthCallback(
    @Param("provider") providerParam: string,
    @Res() res: Response,
    @Query("code") code?: string,
    @Query("state") state?: string,
    @Query("error") error?: string,
  ): Promise<void> {
    // Resolve any white-label URL slug (e.g. GoHighLevel's "leadconnector") back
    // to our internal provider key before anything downstream uses it.
    const provider = OAUTH_CALLBACK_SLUG_ALIASES[providerParam] ?? providerParam;
    const webAppUrl = (this.config.get("WEB_APP_URL", { infer: true }) ?? "").replace(/\/$/, "");
    const back = (status: string) =>
      `${webAppUrl}/integrations?${status}=${encodeURIComponent(provider)}`;

    if (error || !code || !state) {
      res.redirect(back("error"));
      return;
    }
    try {
      await this.crmConnections.completeOAuth(provider, code, state);
      res.redirect(back("connected"));
    } catch (callbackError) {
      // Never surface an exception page to a redirect from the CRM; log and send
      // the user back with an error flag the UI can explain.
      this.logger.warn(
        `OAuth callback failed for ${provider}: ${
          callbackError instanceof Error ? callbackError.message : "unknown error"
        }`,
      );
      res.redirect(back("error"));
    }
  }

  // ---- Inbound contact push (external systems, per-account API key) ----

  /** Auth-test / identity for a per-account API key. Zapier (and any inbound
   * caller) hits this to validate the key and label the connection. Non-secret. */
  @ApiSecurity("api-key")
  @Public()
  // ApiKeyGuard first (populates request.apiKey), then the throttler keys the
  // limit on that key — a per-account budget, not per-IP, so shared inbound
  // source IPs (e.g. Zapier) don't let one account throttle another. ADR 0134.
  @UseGuards(ApiKeyGuard, ApiKeyThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get("me")
  me(
    @Req() request: Request,
  ): Promise<{ accountId: string; accountName: string; plan: string | null }> {
    // ApiKeyGuard guarantees request.apiKey is set.
    return this.apiKeys.accountSummary(request.apiKey!.accountId);
  }

  @ApiSecurity("api-key")
  @Public()
  // Per-account budget (keyed on the API key, not the IP — see /me above and
  // ADR 0134). Higher than /me because a legitimate sync pushes contacts in
  // bursts; still a backstop against a compromised key flooding ingestion.
  @UseGuards(ApiKeyGuard, ApiKeyThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
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
