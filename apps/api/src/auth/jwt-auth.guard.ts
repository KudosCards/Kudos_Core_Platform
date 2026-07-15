import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import jwt from "jsonwebtoken";
import { IS_PUBLIC_KEY } from "./public.decorator";
import type { EnvConfig } from "../config/env.schema";
import type { AuthenticatedUser } from "./types";

interface SupabaseJwtPayload {
  sub: string;
  email?: string;
  aud?: string;
}

function isSupabaseJwtPayload(payload: string | jwt.JwtPayload): payload is SupabaseJwtPayload {
  return typeof payload === "object" && typeof payload.sub === "string";
}

/**
 * Verifies Supabase-issued JWTs against the project's shared JWT secret
 * (HS256) — no network call to Supabase required. Applied globally via
 * APP_GUARD; routes opt out with @Public().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
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

    const payload = this.verify(token);
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

  private verify(token: string): SupabaseJwtPayload {
    try {
      const payload = jwt.verify(token, this.config.get("SUPABASE_JWT_SECRET", { infer: true }), {
        algorithms: ["HS256"],
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
