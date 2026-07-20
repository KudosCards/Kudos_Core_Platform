import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { EnvConfig } from "../config/env.schema";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

/** Turns the configured secret into a 32-byte key: a 64-char hex or 32-byte
 * base64 string is used directly; anything else is SHA-256-hashed. */
function deriveKey(secret: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    return Buffer.from(secret, "hex");
  }
  const base64 = Buffer.from(secret, "base64");
  if (base64.length === 32) {
    return base64;
  }
  return createHash("sha256").update(secret).digest();
}

/**
 * Symmetric encryption for secrets we must store and later re-use — today,
 * customers' CRM API keys (see CrmConnection). AES-256-GCM gives us both
 * confidentiality and tamper detection (the auth tag). The key comes from
 * CREDENTIALS_ENCRYPTION_KEY; without it, encrypt/decrypt refuse rather than
 * silently storing plaintext.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer | null;

  constructor(config: ConfigService<EnvConfig, true>) {
    const secret = config.get("CREDENTIALS_ENCRYPTION_KEY", { infer: true });
    this.key = secret ? deriveKey(secret) : null;
  }

  /** True when CREDENTIALS_ENCRYPTION_KEY is configured. */
  isConfigured(): boolean {
    return this.key !== null;
  }

  /** Returns `iv:tag:ciphertext`, each part base64. */
  encrypt(plaintext: string): string {
    if (!this.key) {
      throw new InternalServerErrorException("CREDENTIALS_ENCRYPTION_KEY is not configured");
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
  }

  decrypt(payload: string): string {
    if (!this.key) {
      throw new InternalServerErrorException("CREDENTIALS_ENCRYPTION_KEY is not configured");
    }
    const [ivB64, tagB64, dataB64] = payload.split(":");
    if (!ivB64 || !tagB64 || !dataB64) {
      throw new InternalServerErrorException("Malformed encrypted payload");
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }
}
