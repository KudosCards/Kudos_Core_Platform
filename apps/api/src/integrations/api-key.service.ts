import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import type { AccountApiKey } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/** 24 random bytes → 48 hex chars of entropy after the `kudos_` prefix. */
const KEY_BYTES = 24;
/** `kudos_` (6) + 8 chars — enough to recognise a key, not enough to be a secret. */
const PREFIX_LENGTH = 14;

function hashKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export interface CreatedApiKeyRecord {
  record: AccountApiKey;
  /** The full plaintext key — returned exactly once, at creation. */
  plaintext: string;
}

/**
 * Per-account API keys for the inbound integrations endpoint. Only the SHA-256
 * hash is stored, so a database leak never exposes a usable key; the plaintext
 * is shown to the customer once. See docs/adr/0015-crm-integrations.md.
 */
@Injectable()
export class ApiKeyService {
  constructor(private readonly prisma: PrismaService) {}

  async create(accountId: string, label: string): Promise<CreatedApiKeyRecord> {
    const plaintext = `kudos_${randomBytes(KEY_BYTES).toString("hex")}`;
    const record = await this.prisma.accountApiKey.create({
      data: {
        accountId,
        label,
        keyHash: hashKey(plaintext),
        prefix: plaintext.slice(0, PREFIX_LENGTH),
      },
    });
    return { record, plaintext };
  }

  list(accountId: string): Promise<AccountApiKey[]> {
    return this.prisma.accountApiKey.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
    });
  }

  async revoke(accountId: string, id: string): Promise<void> {
    // Scope accountId into the mutation so one account can never revoke
    // another's key, and only flip keys that aren't already revoked.
    const { count } = await this.prisma.accountApiKey.updateMany({
      where: { id, accountId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) {
      throw new NotFoundException("API key not found");
    }
  }

  /**
   * Resolves a plaintext key to its account, or null if it's unknown or
   * revoked. Looks the hash up by the unique index, then re-checks it in
   * constant time as defence-in-depth against a timing side channel. Stamps
   * lastUsedAt best-effort (never blocks the request on it).
   */
  async resolve(plaintext: string): Promise<{ accountId: string; keyId: string } | null> {
    const providedHash = hashKey(plaintext);
    const record = await this.prisma.accountApiKey.findFirst({
      where: { keyHash: providedHash, revokedAt: null },
      select: { id: true, accountId: true, keyHash: true },
    });
    if (!record || !safeEqualHex(record.keyHash, providedHash)) {
      return null;
    }
    await this.prisma.accountApiKey
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return { accountId: record.accountId, keyId: record.id };
  }
}

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}
