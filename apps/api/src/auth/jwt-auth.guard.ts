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
      email: payload.email ?? null,
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
      if (payload.aud !== undefined && payload.aud !== "authenticated") {
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
