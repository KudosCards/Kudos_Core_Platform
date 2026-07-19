import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { ApiKeyService } from "./api-key.service";

/** Header the inbound integrations endpoint reads the key from. */
export const API_KEY_HEADER = "x-api-key";

/**
 * Authenticates the public inbound integrations endpoint with a per-account
 * API key (see ApiKeyService). Attaches the resolved account to the request.
 * Used with @Public() so it replaces — not stacks on — the Supabase JWT guard.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers[API_KEY_HEADER];
    const key = Array.isArray(header) ? header[0] : header;
    if (!key) {
      throw new UnauthorizedException(`Missing ${API_KEY_HEADER} header`);
    }

    const resolved = await this.apiKeys.resolve(key);
    if (!resolved) {
      throw new UnauthorizedException("Invalid or revoked API key");
    }

    request.apiKey = resolved;
    return true;
  }
}
