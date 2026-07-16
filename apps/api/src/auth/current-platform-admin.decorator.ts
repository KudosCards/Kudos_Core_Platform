import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { PlatformAdminContext } from "./types";

/** The current internal operator, populated by PlatformAdminGuard. */
export const CurrentPlatformAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PlatformAdminContext => {
    const request = ctx.switchToHttp().getRequest<Request>();
    if (!request.platformAdmin) {
      throw new Error("CurrentPlatformAdmin decorator used outside of PlatformAdminGuard");
    }
    return request.platformAdmin;
  },
);
