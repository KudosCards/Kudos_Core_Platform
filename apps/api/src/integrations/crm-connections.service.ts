import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { CrmConnection, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CryptoService } from "../common/crypto.service";
import { AuditService } from "../audit/audit.service";
import { RecipientsService, type IngestResult } from "../recipients/recipients.service";
import { BREVO_CLIENT, type BrevoClient } from "./brevo/brevo-client";
import { DEFAULT_BREVO_MAPPING, mapBrevoContact, type BrevoFieldMapping } from "./brevo/brevo.mapper";

/** The CRMs Phase 2 supports (API-key lane). OAuth CRMs land later via Nango. */
export const SUPPORTED_PROVIDERS = ["brevo"] as const;
export type CrmProvider = (typeof SUPPORTED_PROVIDERS)[number];

/** Non-secret view of a connection — never includes the encrypted key. */
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
    @Inject(BREVO_CLIENT) private readonly brevo: BrevoClient,
  ) {}

  private assertProvider(provider: string): asserts provider is CrmProvider {
    if (!SUPPORTED_PROVIDERS.includes(provider as CrmProvider)) {
      throw new BadRequestException(`Unsupported CRM provider "${provider}"`);
    }
  }

  /** Verifies the key works, then stores it encrypted (upsert per provider). */
  async connect(
    accountId: string,
    actorUserId: string,
    provider: string,
    apiKey: string,
    fieldMapping?: Partial<BrevoFieldMapping>,
  ): Promise<CrmConnectionView> {
    this.assertProvider(provider);
    if (!this.crypto.isConfigured()) {
      throw new ServiceUnavailableException(
        "CRM connections aren't enabled on this server yet (no encryption key configured)",
      );
    }

    await this.brevo.verifyKey(apiKey);

    const encryptedApiKey = this.crypto.encrypt(apiKey);
    const mapping = (fieldMapping ?? null) as Prisma.InputJsonValue | null;
    const connection = await this.prisma.crmConnection.upsert({
      where: { accountId_provider: { accountId, provider } },
      create: {
        accountId,
        provider,
        encryptedApiKey,
        ...(mapping !== null && { fieldMapping: mapping }),
      },
      update: {
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
      const apiKey = this.crypto.decrypt(connection.encryptedApiKey);
      const mapping = this.resolveMapping(connection.fieldMapping);
      const rawContacts = await this.brevo.fetchContacts(apiKey);

      const contacts = rawContacts
        .map((contact) => mapBrevoContact(contact, mapping))
        .filter((c): c is NonNullable<typeof c> => c !== null);

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
      return { fetched: rawContacts.length, ...result };
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

  private resolveMapping(stored: Prisma.JsonValue | null): BrevoFieldMapping {
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      return { ...DEFAULT_BREVO_MAPPING, ...(stored as Partial<BrevoFieldMapping>) };
    }
    return DEFAULT_BREVO_MAPPING;
  }
}
