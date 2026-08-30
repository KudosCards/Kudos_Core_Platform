import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { JWKS_RESOLVER } from "./jwks.provider";
import type { AuthenticatedUser } from "./types";

interface SupabaseJwtPayload extends JWTPayload {
  sub: string;
  email?: string;
  /** Supabase mirrors the confirmation state into the user's metadata. */
  user_metadata?: { email_verified?: unknown };
  /** Some GoTrue versions/providers put it at the top level as well. */
  email_verified?: unknown;
}

/**
 * Whether the token asserts the address has been confirmed.
 *
 * Both places Supabase writes it are checked, and only a literal `true` counts —
 * an absent claim is treated as unverified, so a token minted by something that
 * does not say is refused rather than assumed.
 *
 * Worth being precise about what this buys, because it is easy to overstate:
 * `user_metadata` is writable by the user it belongs to, so this is a guard
 * against an *honest* session carrying an unconfirmed address — an OAuth
 * provider that asserts an email it never checked, or a session minted before
 * confirmation — not against a determined attacker with an account. Where
 * nothing else binds the request, an authoritative lookup is used instead. See
 * ADR 0188.
 */
function assertsEmailVerified(payload: SupabaseJwtPayload): boolean {
  return payload.user_metadata?.email_verified === true || payload.email_verified === true;
}

function isSupabaseJwtPayload(payload: JWTPayload): payload is SupabaseJwtPayload {
  return typeof payload.sub === "string";
}

/**
 * Verifies Supabase-issued JWTs against the project's published JWKS
 * (asymmetric ECC P-256 verification keys, fetched and cached by `jose`,
 * re-fetched automatically on key rotation) — no shared secret involved.
 * Applied globally via APP_GUARD; routes opt out with @Public().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(JWKS_RESOLVER) private readonly jwks: JWTVerifyGetKey,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException("Missing bearer token");
    }

    const payload = await this.verify(token);
    const authUser: AuthenticatedUser = {
      id: payload.sub,
      unverifiedEmail: payload.email ?? null,
      emailVerified: assertsEmailVerified(payload),
    };
    request.authUser = authUser;
    return true;
  }

  private extractToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return null;
    }
    return header.slice("Bearer ".length).trim() || null;
  }

  private async verify(token: string): Promise<SupabaseJwtPayload> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        algorithms: ["ES256"],
      });
      if (!isSupabaseJwtPayload(payload)) {
        throw new UnauthorizedException("Malformed token payload");
      }
      if (payload.aud !== "authenticated") {
        throw new UnauthorizedException("Unexpected token audience");
      }
      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException("Invalid or expired token");
    }
  }
}
