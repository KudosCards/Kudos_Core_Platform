import { randomBytes } from "node:crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CrmConnection, Prisma } from "@prisma/client";
import type { EnvConfig } from "../config/env.schema";
import { PrismaService } from "../prisma/prisma.service";
import { CryptoService } from "../common/crypto.service";
import { AuditService } from "../audit/audit.service";
import {
  RecipientsService,
  type IngestResult,
  type NormalizedContact,
} from "../recipients/recipients.service";
import { BREVO_CLIENT, type BrevoClient } from "./brevo/brevo-client";
import { DEFAULT_BREVO_MAPPING, mapBrevoContact, type BrevoFieldMapping } from "./brevo/brevo.mapper";
import {
  HUBSPOT_AUTHORIZE_URL,
  HUBSPOT_CLIENT,
  HUBSPOT_SCOPES,
  type HubSpotClient,
} from "./hubspot/hubspot-client";
import {
  DEFAULT_HUBSPOT_MAPPING,
  hubspotProperties,
  mapHubSpotContact,
} from "./hubspot/hubspot.mapper";

/** How a provider authenticates. Drives which connect path and sync fetch it uses. */
type AuthType = "api_key" | "oauth";

/** The CRMs we support and how each authenticates. Adding a provider is an entry
 * here plus its client + mapper — the ingest funnel is shared. */
export const CRM_PROVIDERS = {
  brevo: { authType: "api_key" },
  hubspot: { authType: "oauth" },
} as const satisfies Record<string, { authType: AuthType }>;

export type CrmProvider = keyof typeof CRM_PROVIDERS;
export const SUPPORTED_PROVIDERS = Object.keys(CRM_PROVIDERS) as CrmProvider[];

/** How long a signed OAuth `state` stays valid (CSRF window). */
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
/** Refresh a HubSpot access token this long before it actually expires. */
const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

/** Non-secret view of a connection — never includes any encrypted credential. */
export interface CrmConnectionView {
  provider: string;
  syncEnabled: boolean;
  lastSyncedAt: Date | null;
  lastSyncStatus: string | null;
  createdAt: Date;
}

export interface CrmSyncResult extends IngestResult {
  fetched: number;
}

/** What a signed OAuth state carries across the redirect — the account/user we
 * started for, so the public callback can trust who to store the tokens against. */
interface OAuthState {
  accountId: string;
  userId: string;
  provider: string;
  nonce: string;
  iat: number;
}

function toView(connection: CrmConnection): CrmConnectionView {
  return {
    provider: connection.provider,
    syncEnabled: connection.syncEnabled,
    lastSyncedAt: connection.lastSyncedAt,
    lastSyncStatus: connection.lastSyncStatus,
    createdAt: connection.createdAt,
  };
}

@Injectable()
export class CrmConnectionsService {
  private readonly logger = new Logger(CrmConnectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly recipients: RecipientsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(BREVO_CLIENT) private readonly brevo: BrevoClient,
    @Inject(HUBSPOT_CLIENT) private readonly hubspot: HubSpotClient,
  ) {}

  private assertProvider(provider: string): asserts provider is CrmProvider {
    if (!(provider in CRM_PROVIDERS)) {
      throw new BadRequestException(`Unsupported CRM provider "${provider}"`);
    }
  }

  private assertCryptoConfigured(): void {
    if (!this.crypto.isConfigured()) {
      throw new ServiceUnavailableException(
        "CRM connections aren't enabled on this server yet (no encryption key configured)",
      );
    }
  }

  // ---------------------------------------------------------------------------
  // API-key lane (Brevo): verify the key, store it encrypted.
  // ---------------------------------------------------------------------------

  async connect(
    accountId: string,
    actorUserId: string,
    provider: string,
    apiKey: string,
    fieldMapping?: Partial<BrevoFieldMapping>,
  ): Promise<CrmConnectionView> {
    this.assertProvider(provider);
    if (CRM_PROVIDERS[provider].authType !== "api_key") {
      throw new BadRequestException(`${provider} connects via OAuth, not an API key`);
    }
    this.assertCryptoConfigured();

    await this.brevo.verifyKey(apiKey);

    const encryptedApiKey = this.crypto.encrypt(apiKey);
    const mapping = (fieldMapping ?? null) as Prisma.InputJsonValue | null;
    const connection = await this.prisma.crmConnection.upsert({
      where: { accountId_provider: { accountId, provider } },
      create: {
        accountId,
        provider,
        authType: "api_key",
        encryptedApiKey,
        ...(mapping !== null && { fieldMapping: mapping }),
      },
      update: {
        authType: "api_key",
        encryptedApiKey,
        syncEnabled: true,
        ...(mapping !== null && { fieldMapping: mapping }),
      },
    });

    await this.audit.record({
      accountId,
      actorUserId,
      action: "crm_connect",
      targetType: "CrmConnection",
      targetId: connection.id,
      metadata: { provider },
    });
    return toView(connection);
  }

  // ---------------------------------------------------------------------------
  // OAuth lane (HubSpot): redirect to consent, then store tokens on callback.
  // ---------------------------------------------------------------------------

  /** Builds the provider's authorization URL to redirect the user to, carrying a
   * signed `state` that ties the callback back to this account (CSRF defence). */
  startOAuth(accountId: string, actorUserId: string, provider: string): { url: string } {
    this.assertProvider(provider);
    if (CRM_PROVIDERS[provider].authType !== "oauth") {
      throw new BadRequestException(`${provider} doesn't connect via OAuth`);
    }
    this.assertCryptoConfigured();
    this.assertHubSpotConfigured();

    const state = this.signState({
      accountId,
      userId: actorUserId,
      provider,
      nonce: randomBytes(16).toString("hex"),
      iat: Date.now(),
    });

    const params = new URLSearchParams({
      client_id: this.config.get("HUBSPOT_CLIENT_ID", { infer: true }) ?? "",
      redirect_uri: this.config.get("HUBSPOT_REDIRECT_URI", { infer: true }) ?? "",
      scope: HUBSPOT_SCOPES.join(" "),
      state,
    });
    return { url: `${HUBSPOT_AUTHORIZE_URL}?${params.toString()}` };
  }

  /** Handles the OAuth callback: validates state, exchanges the code for tokens,
   * stores them encrypted. Returns the account it connected (for the redirect). */
  async completeOAuth(
    provider: string,
    code: string,
    rawState: string,
  ): Promise<{ accountId: string }> {
    this.assertProvider(provider);
    if (CRM_PROVIDERS[provider].authType !== "oauth") {
      throw new BadRequestException(`${provider} doesn't connect via OAuth`);
    }
    this.assertCryptoConfigured();
    this.assertHubSpotConfigured();

    const state = this.verifyState(rawState);
    if (state.provider !== provider) {
      throw new BadRequestException("OAuth state does not match the provider");
    }

    const tokens = await this.hubspot.exchangeCode(code);

    const connection = await this.prisma.crmConnection.upsert({
      where: { accountId_provider: { accountId: state.accountId, provider } },
      create: {
        accountId: state.accountId,
        provider,
        authType: "oauth",
        encryptedAccessToken: this.crypto.encrypt(tokens.accessToken),
        encryptedRefreshToken: this.crypto.encrypt(tokens.refreshToken),
        tokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
      },
      update: {
        authType: "oauth",
        encryptedAccessToken: this.crypto.encrypt(tokens.accessToken),
        encryptedRefreshToken: this.crypto.encrypt(tokens.refreshToken),
        tokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
        syncEnabled: true,
      },
    });

    await this.audit.record({
      accountId: state.accountId,
      actorUserId: state.userId,
      action: "crm_connect",
      targetType: "CrmConnection",
      targetId: connection.id,
      metadata: { provider },
    });
    return { accountId: state.accountId };
  }

  // ---------------------------------------------------------------------------
  // Shared: list, disconnect, sync (the funnel), scheduled sweep.
  // ---------------------------------------------------------------------------

  async list(accountId: string): Promise<CrmConnectionView[]> {
    const connections = await this.prisma.crmConnection.findMany({
      where: { accountId },
      orderBy: { createdAt: "asc" },
    });
    return connections.map(toView);
  }

  async disconnect(accountId: string, actorUserId: string, provider: string): Promise<void> {
    const { count } = await this.prisma.crmConnection.deleteMany({
      where: { accountId, provider },
    });
    if (count === 0) {
      throw new NotFoundException("No such connection");
    }
    await this.audit.record({
      accountId,
      actorUserId,
      action: "crm_disconnect",
      targetType: "CrmConnection",
      targetId: `${accountId}:${provider}`,
      metadata: { provider },
    });
  }

  /** Pulls contacts from the CRM and funnels them through the recipient ingest
   * engine (source = the provider). Records the outcome on the connection. */
  async sync(accountId: string, actorUserId: string, provider: string): Promise<CrmSyncResult> {
    this.assertProvider(provider);
    const connection = await this.prisma.crmConnection.findUnique({
      where: { accountId_provider: { accountId, provider } },
    });
    if (!connection) {
      throw new NotFoundException("No such connection");
    }

    try {
      const { contacts, fetched } = await this.fetchContacts(connection);
      const result = await this.recipients.ingestFromSource(
        accountId,
        provider,
        contacts,
        actorUserId,
      );

      await this.prisma.crmConnection.update({
        where: { id: connection.id },
        data: { lastSyncedAt: new Date(), lastSyncStatus: "ok" },
      });
      return { fetched, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.logger.warn(`CRM sync failed for account ${accountId} (${provider}): ${message}`);
      await this.prisma.crmConnection.update({
        where: { id: connection.id },
        data: { lastSyncedAt: new Date(), lastSyncStatus: `error: ${message}`.slice(0, 200) },
      });
      throw error;
    }
  }

  /** Every enabled connection, for the scheduled sweep. */
  listEnabled(): Promise<CrmConnection[]> {
    return this.prisma.crmConnection.findMany({ where: { syncEnabled: true } });
  }

  // ---------------------------------------------------------------------------
  // Per-provider fetch: decrypt credentials, pull, map to NormalizedContact.
  // ---------------------------------------------------------------------------

  private async fetchContacts(
    connection: CrmConnection,
  ): Promise<{ contacts: NormalizedContact[]; fetched: number }> {
    switch (connection.provider) {
      case "brevo":
        return this.fetchBrevoContacts(connection);
      case "hubspot":
        return this.fetchHubSpotContacts(connection);
      default:
        throw new BadRequestException(`Unsupported CRM provider "${connection.provider}"`);
    }
  }

  private async fetchBrevoContacts(
    connection: CrmConnection,
  ): Promise<{ contacts: NormalizedContact[]; fetched: number }> {
    if (!connection.encryptedApiKey) {
      throw new BadRequestException("Brevo connection is missing its API key");
    }
    const apiKey = this.crypto.decrypt(connection.encryptedApiKey);
    const mapping = this.resolveMapping(connection.fieldMapping, DEFAULT_BREVO_MAPPING);
    const raw = await this.brevo.fetchContacts(apiKey);
    const contacts = raw
      .map((contact) => mapBrevoContact(contact, mapping))
      .filter((c): c is NormalizedContact => c !== null);
    return { contacts, fetched: raw.length };
  }

  private async fetchHubSpotContacts(
    connection: CrmConnection,
  ): Promise<{ contacts: NormalizedContact[]; fetched: number }> {
    this.assertHubSpotConfigured();
    const accessToken = await this.validHubSpotAccessToken(connection);
    const mapping = this.resolveMapping(connection.fieldMapping, DEFAULT_HUBSPOT_MAPPING);
    const raw = await this.hubspot.fetchContacts(accessToken, hubspotProperties(mapping));
    const contacts = raw
      .map((contact) => mapHubSpotContact(contact, mapping))
      .filter((c): c is NormalizedContact => c !== null);
    return { contacts, fetched: raw.length };
  }

  /** Returns a usable HubSpot access token, refreshing (and persisting the new
   * tokens) first if the stored one is missing or about to expire. */
  private async validHubSpotAccessToken(connection: CrmConnection): Promise<string> {
    const stillValid =
      connection.encryptedAccessToken &&
      connection.tokenExpiresAt &&
      connection.tokenExpiresAt.getTime() - TOKEN_REFRESH_BUFFER_MS > Date.now();

    if (stillValid && connection.encryptedAccessToken) {
      return this.crypto.decrypt(connection.encryptedAccessToken);
    }

    if (!connection.encryptedRefreshToken) {
      throw new UnauthorizedException("HubSpot connection has no refresh token — reconnect it");
    }
    const refreshToken = this.crypto.decrypt(connection.encryptedRefreshToken);
    const tokens = await this.hubspot.refreshTokens(refreshToken);

    await this.prisma.crmConnection.update({
      where: { id: connection.id },
      data: {
        encryptedAccessToken: this.crypto.encrypt(tokens.accessToken),
        encryptedRefreshToken: this.crypto.encrypt(tokens.refreshToken),
        tokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
      },
    });
    return tokens.accessToken;
  }

  // ---------------------------------------------------------------------------
  // Helpers.
  // ---------------------------------------------------------------------------

  private isHubSpotConfigured(): boolean {
    return Boolean(
      this.config.get("HUBSPOT_CLIENT_ID", { infer: true }) &&
        this.config.get("HUBSPOT_CLIENT_SECRET", { infer: true }) &&
        this.config.get("HUBSPOT_REDIRECT_URI", { infer: true }),
    );
  }

  private assertHubSpotConfigured(): void {
    if (!this.isHubSpotConfigured()) {
      throw new ServiceUnavailableException("HubSpot isn't enabled on this server yet");
    }
  }

  /** Merges a stored partial mapping over the provider's defaults. */
  private resolveMapping<T extends object>(stored: Prisma.JsonValue | null, defaults: T): T {
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      return { ...defaults, ...(stored as Partial<T>) };
    }
    return defaults;
  }

  /** Signs an OAuth state with the same AES-256-GCM key we encrypt credentials
   * with — the auth tag makes a forged/tampered state fail to decrypt, which is
   * exactly the CSRF property we need. */
  private signState(state: OAuthState): string {
    return this.crypto.encrypt(JSON.stringify(state));
  }

  private verifyState(rawState: string): OAuthState {
    let state: OAuthState;
    try {
      state = JSON.parse(this.crypto.decrypt(rawState)) as OAuthState;
    } catch {
      throw new BadRequestException("Invalid OAuth state");
    }
    if (
      typeof state.accountId !== "string" ||
      typeof state.userId !== "string" ||
      typeof state.iat !== "number"
    ) {
      throw new BadRequestException("Malformed OAuth state");
    }
    if (Date.now() - state.iat > OAUTH_STATE_TTL_MS) {
      throw new BadRequestException("OAuth state has expired — please try connecting again");
    }
    return state;
  }
}
