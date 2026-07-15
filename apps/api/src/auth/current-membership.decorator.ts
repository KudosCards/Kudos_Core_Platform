import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { CurrentMembershipContext } from "./types";

/** The current user's account + role, populated by MembershipGuard. */
export const CurrentMembership = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentMembershipContext => {
    const request = ctx.switchToHttp().getRequest<Request>();
    if (!request.membership) {
      throw new Error("CurrentMembership decorator used outside of MembershipGuard");
    }
    return request.membership;
  },
);
