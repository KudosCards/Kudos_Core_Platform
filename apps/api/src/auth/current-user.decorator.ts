import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { AuthenticatedUser } from "./types";

/** The authenticated Supabase user, populated by JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<Request>();
    if (!request.authUser) {
      throw new Error("CurrentUser decorator used outside of JwtAuthGuard");
    }
    return request.authUser;
  },
);
