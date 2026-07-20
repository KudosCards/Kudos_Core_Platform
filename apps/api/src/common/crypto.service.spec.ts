import type { ConfigService } from "@nestjs/config";
import { CryptoService } from "./crypto.service";

function makeService(secret?: string): CryptoService {
  const config = { get: () => secret } as unknown as ConfigService<never, true>;
  return new CryptoService(config);
}

describe("CryptoService", () => {
  const key = "a".repeat(64); // 64 hex chars = 32 bytes

  it("round-trips a secret and never stores it in the clear", () => {
    const service = makeService(key);
    const encrypted = service.encrypt("brevo_api_secret");
    expect(encrypted).not.toContain("brevo_api_secret");
    expect(encrypted.split(":")).toHaveLength(3);
    expect(service.decrypt(encrypted)).toBe("brevo_api_secret");
  });

  it("detects tampering via the GCM auth tag", () => {
    const service = makeService(key);
    const [iv, tag] = service.encrypt("x").split(":");
    const tampered = `${iv}:${tag}:${Buffer.from("evil").toString("base64")}`;
    expect(() => service.decrypt(tampered)).toThrow();
  });

  it("refuses to encrypt or decrypt when no key is configured", () => {
    const service = makeService(undefined);
    expect(service.isConfigured()).toBe(false);
    expect(() => service.encrypt("x")).toThrow(/not configured/i);
  });
});
