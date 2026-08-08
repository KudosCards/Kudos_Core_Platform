import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";

/**
 * ThrottlerGuard variant that keys the rate limit on the resolved per-account
 * API key (set on the request by ApiKeyGuard) rather than the client IP.
 *
 * Why per-key, not per-IP: legitimate inbound callers (e.g. Zapier) reach the
 * API from a small shared pool of source IPs across *many* customers, so an
 * IP-keyed limit would let one busy account throttle unrelated ones. Keying on
 * the API key gives each account its own independent budget. Falls back to the
 * client IP when no key is present (e.g. a missing-key request that still
 * reaches the throttler). Register it AFTER ApiKeyGuard so `request.apiKey` is
 * already populated. See ADR 0134.
 */
@Injectable()
export class ApiKeyThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as unknown as Request;
    const keyId = request.apiKey?.keyId;
    if (keyId) {
      return Promise.resolve(`api-key:${keyId}`);
    }
    const forwarded = request.ips?.[0];
    return Promise.resolve(forwarded ?? request.ip ?? "unknown");
  }
}
