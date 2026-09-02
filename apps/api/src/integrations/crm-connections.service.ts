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
import type { OAuthCrmClient } from "./oauth-crm-client";
import { BREVO_CLIENT, type BrevoClient } from "./brevo/brevo-client";
import {
  DEFAULT_BREVO_MAPPING,
  mapBrevoContact,
  type BrevoFieldMapping,
} from "./brevo/brevo.mapper";
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
import {
  GOHIGHLEVEL_AUTHORIZE_URL,
  GOHIGHLEVEL_CLIENT,
  GOHIGHLEVEL_SCOPES,
  type GoHighLevelClient,
} from "./gohighlevel/gohighlevel-client";
import {
  DEFAULT_GOHIGHLEVEL_MAPPING,
  mapGoHighLevelContact,
} from "./gohighlevel/gohighlevel.mapper";

/** How a provider authenticates. Drives which connect path and sync fetch it uses. */
type AuthType = "api_key" | "oauth";

/** The CRMs we support and how each authenticates. Adding a provider is an entry
 * here plus its client + mapper — the ingest funnel is shared. */
export const CRM_PROVIDERS = {
  brevo: { authType: "api_key", needsExternalAccount: false },
  hubspot: { authType: "oauth", needsExternalAccount: false },
  // GoHighLevel scopes contacts to one location, so a grant without a locationId
  // can never sync. Its consent screen offers the agency as well as the
  // sub-accounts, and picking the agency yields exactly that. See ADR 0213.
  gohighlevel: { authType: "oauth", needsExternalAccount: true },
} as const satisfies Record<string, { authType: AuthType; needsExternalAccount: boolean }>;

export type CrmProvider = keyof typeof CRM_PROVIDERS;
export const SUPPORTED_PROVIDERS = Object.keys(CRM_PROVIDERS) as CrmProvider[];

/**
 * A grant that completed but cannot be used — the customer chose something the
 * integration can't work with, and the only useful thing to tell them is which
 * choice to make instead. Carries a `reason` so the callback redirect can send
 * the page something better than "it failed".
 */
export class UnusableGrantException extends BadRequestException {
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

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
  /** Rows the provider returned that the mapper could make nothing of — no
   * first or last name, so there is nobody to address a card to. They never
   * reached the ingest, so they appear in no other count. */
  unmappable: number;
  /** True when the provider's paging cap stopped the pull with more contacts
   * still to read — the import is partial, not complete. */
  truncated: boolean;
}

/** One provider's pull, before ingest: the mapped contacts, how many rows the
 * provider actually handed over, and whether its paging cap cut the pull short. */
interface ProviderFetch {
  contacts: NormalizedContact[];
  fetched: number;
  truncated: boolean;
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

/**
 * The status stored when a pull stopped at the provider's page cap. It is
 * deliberately not "ok": the connections list renders any non-"ok" status
 * verbatim, so this is what tells a customer their address book only came
 * across in part — the thing the previous "ok" hid from them entirely.
 */
export function partialSyncStatus(fetched: number): string {
  return `partial: stopped at the provider page limit after ${fetched} contacts — some were not imported`;
}

/** The column this is written to holds 200 characters. */
const SYNC_STATUS_MAX = 200;

/**
 * What to store on the connection after a successful pull.
 *
 * "ok" used to be written whenever the pull itself completed, no matter what
 * the ingest made of it — so a sync that dropped a third of a portal for want
 * of surnames left the same trace as one that brought everything across. For a
 * nightly sync this string is the *only* trace: nobody is watching, and the
 * summary panel that would have said more is never rendered. It is also what
 * the connections list shows verbatim on the next page load.
 *
 * So "ok" now means what it says, and anything short of it says how short.
 * See ADR 0227.
 */
export function syncStatus(input: {
  truncated: boolean;
  fetched: number;
  unmappable: number;
  skipped: number;
}): string {
  // Truncation outranks the rest: it means contacts we never even saw, so the
  // counts below describe a sample rather than the address book.
  if (input.truncated) {
    return partialSyncStatus(input.fetched).slice(0, SYNC_STATUS_MAX);
  }
  const missing = input.unmappable + input.skipped;
  if (missing === 0) {
    return "ok";
  }
  const reasons = [
    input.unmappable > 0 ? `${input.unmappable} with no first or last name` : null,
    input.skipped > 0 ? `${input.skipped} already on file or over your plan's limit` : null,
  ].filter((part): part is string => part !== null);
  return `incomplete: ${missing} of ${input.fetched} contacts were not imported — ${reasons.join(", ")}`.slice(
    0,
    SYNC_STATUS_MAX,
  );
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
    @Inject(GOHIGHLEVEL_CLIENT) private readonly ghl: GoHighLevelClient,
  ) {}

  /** Per-provider OAuth wiring — the authorize URL, scopes, redirect/client id,
   * the token client, and whether it's configured on this server. Adding an OAuth
   * CRM is a case here plus its client + mapper; the flow below is shared. */
  private oauthDescriptor(provider: CrmProvider): {
    client: OAuthCrmClient;
    clientId: string;
    redirectUri: string;
    authorizeUrl: string;
    scope: string;
    configured: boolean;
  } {
    switch (provider) {
      case "hubspot": {
        const clientId = this.config.get("HUBSPOT_CLIENT_ID", { infer: true });
        const clientSecret = this.config.get("HUBSPOT_CLIENT_SECRET", { infer: true });
        const redirectUri = this.config.get("HUBSPOT_REDIRECT_URI", { infer: true });
        return {
          client: this.hubspot,
          clientId: clientId ?? "",
          redirectUri: redirectUri ?? "",
          authorizeUrl: HUBSPOT_AUTHORIZE_URL,
          scope: HUBSPOT_SCOPES.join(" "),
          configured: Boolean(clientId && clientSecret && redirectUri),
        };
      }
      case "gohighlevel": {
        const clientId = this.config.get("GOHIGHLEVEL_CLIENT_ID", { infer: true });
        const clientSecret = this.config.get("GOHIGHLEVEL_CLIENT_SECRET", { infer: true });
        const redirectUri = this.config.get("GOHIGHLEVEL_REDIRECT_URI", { infer: true });
        return {
          client: this.ghl,
          clientId: clientId ?? "",
          redirectUri: redirectUri ?? "",
          authorizeUrl: GOHIGHLEVEL_AUTHORIZE_URL,
          scope: GOHIGHLEVEL_SCOPES.join(" "),
          configured: Boolean(clientId && clientSecret && redirectUri),
        };
      }
      default:
        // brevo (api_key) never reaches an OAuth path.
        throw new BadRequestException(`${provider} doesn't connect via OAuth`);
    }
  }

  private assertOAuthConfigured(provider: CrmProvider): void {
    if (!this.oauthDescriptor(provider).configured) {
      throw new ServiceUnavailableException(`${provider} isn't enabled on this server yet`);
    }
  }

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
    this.assertOAuthConfigured(provider);
    const descriptor = this.oauthDescriptor(provider);

    const state = this.signState({
      accountId,
      userId: actorUserId,
      provider,
      nonce: randomBytes(16).toString("hex"),
      iat: Date.now(),
    });

    const params = new URLSearchParams({
      response_type: "code",
      client_id: descriptor.clientId,
      redirect_uri: descriptor.redirectUri,
      scope: descriptor.scope,
      state,
    });
    return { url: `${descriptor.authorizeUrl}?${params.toString()}` };
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
    this.assertOAuthConfigured(provider);

    const state = this.verifyState(rawState);
    if (state.provider !== provider) {
      throw new BadRequestException("OAuth state does not match the provider");
    }

    const tokens = await this.oauthDescriptor(provider).client.exchangeCode(code);

    // Refuse here rather than storing something that can never sync. The grant
    // is real — tokens and all — but without the account it is scoped to there
    // is nothing to fetch, and the old behaviour stored it as a healthy
    // connection that failed every night with "please reconnect it": advice to
    // repeat the very action that had just failed.
    if (CRM_PROVIDERS[provider].needsExternalAccount && !tokens.externalAccountId) {
      throw new UnusableGrantException(
        "no_location",
        `${provider} granted access to an agency rather than a sub-account, which has no contacts to import`,
      );
    }

    const tokenExpiresAt = new Date(Date.now() + tokens.expiresInSeconds * 1000);

    const connection = await this.prisma.crmConnection.upsert({
      where: { accountId_provider: { accountId: state.accountId, provider } },
      create: {
        accountId: state.accountId,
        provider,
        authType: "oauth",
        encryptedAccessToken: this.crypto.encrypt(tokens.accessToken),
        encryptedRefreshToken: this.crypto.encrypt(tokens.refreshToken),
        tokenExpiresAt,
        // GoHighLevel: the locationId the token is scoped to (null for HubSpot).
        externalAccountId: tokens.externalAccountId ?? null,
      },
      update: {
        authType: "oauth",
        encryptedAccessToken: this.crypto.encrypt(tokens.accessToken),
        encryptedRefreshToken: this.crypto.encrypt(tokens.refreshToken),
        tokenExpiresAt,
        syncEnabled: true,
        ...(tokens.externalAccountId && { externalAccountId: tokens.externalAccountId }),
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
      const { contacts, fetched, truncated } = await this.fetchContacts(connection);
      // Rows the provider sent that the mapper could do nothing with. Counted
      // here rather than in each provider's fetch because every one of them
      // reports `fetched` as the raw row count and `contacts` as what survived
      // mapping — the difference is the same thing in all three.
      const unmappable = Math.max(0, fetched - contacts.length);
      const result = await this.recipients.ingestFromSource(
        accountId,
        provider,
        contacts,
        actorUserId,
      );

      if (truncated) {
        this.logger.warn(
          `CRM sync for account ${accountId} (${provider}) hit the provider page limit ` +
            `after ${fetched} contacts — the import is partial`,
        );
      }
      await this.prisma.crmConnection.update({
        where: { id: connection.id },
        data: {
          lastSyncedAt: new Date(),
          lastSyncStatus: syncStatus({
            truncated,
            fetched,
            unmappable,
            skipped: result.skipped,
          }),
        },
      });
      return { fetched, unmappable, truncated, ...result };
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

  private async fetchContacts(connection: CrmConnection): Promise<ProviderFetch> {
    switch (connection.provider) {
      case "brevo":
        return this.fetchBrevoContacts(connection);
      case "hubspot":
        return this.fetchHubSpotContacts(connection);
      case "gohighlevel":
        return this.fetchGoHighLevelContacts(connection);
      default:
        throw new BadRequestException(`Unsupported CRM provider "${connection.provider}"`);
    }
  }

  private async fetchBrevoContacts(connection: CrmConnection): Promise<ProviderFetch> {
    if (!connection.encryptedApiKey) {
      throw new BadRequestException("Brevo connection is missing its API key");
    }
    const apiKey = this.crypto.decrypt(connection.encryptedApiKey);
    const mapping = this.resolveMapping(connection.fieldMapping, DEFAULT_BREVO_MAPPING);
    const { contacts: raw, truncated } = await this.brevo.fetchContacts(apiKey);
    const contacts = raw
      .map((contact) => mapBrevoContact(contact, mapping))
      .filter((c): c is NormalizedContact => c !== null);
    return { contacts, fetched: raw.length, truncated };
  }

  private async fetchHubSpotContacts(connection: CrmConnection): Promise<ProviderFetch> {
    this.assertOAuthConfigured("hubspot");
    const accessToken = await this.validAccessToken("hubspot", connection);
    const mapping = this.resolveMapping(connection.fieldMapping, DEFAULT_HUBSPOT_MAPPING);
    const { contacts: raw, truncated } = await this.hubspot.fetchContacts(
      accessToken,
      hubspotProperties(mapping),
    );
    const contacts = raw
      .map((contact) => mapHubSpotContact(contact, mapping))
      .filter((c): c is NormalizedContact => c !== null);
    return { contacts, fetched: raw.length, truncated };
  }

  private async fetchGoHighLevelContacts(connection: CrmConnection): Promise<ProviderFetch> {
    this.assertOAuthConfigured("gohighlevel");
    // GoHighLevel scopes contacts to the location the token was granted for; we
    // persisted that locationId as externalAccountId at connect time.
    const locationId = connection.externalAccountId;
    if (!locationId) {
      // Connections stored before the callback started refusing these. The old
      // wording said only "please reconnect it", which is the action that had
      // just failed — say which of the two choices to make instead.
      throw new BadRequestException(
        "This GoHighLevel connection is to an agency, which has no contacts to import. " +
          "Disconnect, connect again, and choose the sub-account you want contacts from.",
      );
    }
    const accessToken = await this.validAccessToken("gohighlevel", connection);
    const mapping = this.resolveMapping(connection.fieldMapping, DEFAULT_GOHIGHLEVEL_MAPPING);
    const { contacts: raw, truncated } = await this.ghl.fetchContacts(accessToken, locationId);
    const contacts = raw
      .map((contact) => mapGoHighLevelContact(contact, mapping))
      .filter((c): c is NormalizedContact => c !== null);
    return { contacts, fetched: raw.length, truncated };
  }

  /** Returns a usable access token for an OAuth provider, refreshing (and
   * persisting the new tokens) first if the stored one is missing or about to
   * expire. Works for any OAuth CRM via its `oauthDescriptor` client. */
  private async validAccessToken(
    provider: CrmProvider,
    connection: CrmConnection,
  ): Promise<string> {
    const stillValid =
      connection.encryptedAccessToken &&
      connection.tokenExpiresAt &&
      connection.tokenExpiresAt.getTime() - TOKEN_REFRESH_BUFFER_MS > Date.now();

    if (stillValid && connection.encryptedAccessToken) {
      return this.crypto.decrypt(connection.encryptedAccessToken);
    }

    if (!connection.encryptedRefreshToken) {
      throw new UnauthorizedException(`${provider} connection has no refresh token — reconnect it`);
    }
    const refreshToken = this.crypto.decrypt(connection.encryptedRefreshToken);
    const tokens = await this.oauthDescriptor(provider).client.refreshTokens(refreshToken);

    await this.prisma.crmConnection.update({
      where: { id: connection.id },
      data: {
        encryptedAccessToken: this.crypto.encrypt(tokens.accessToken),
        encryptedRefreshToken: this.crypto.encrypt(tokens.refreshToken),
        tokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
        ...(tokens.externalAccountId && { externalAccountId: tokens.externalAccountId }),
      },
    });
    return tokens.accessToken;
  }

  // ---------------------------------------------------------------------------
  // Helpers.
  // ---------------------------------------------------------------------------

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
