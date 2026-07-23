import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Resolves the current authenticated user's Membership (account + role) and
 * attaches it to the request. Must run after JwtAuthGuard. Routes that
 * create the first Membership for a user (account signup) must not use
 * this guard.
 */
@Injectable()
export class MembershipGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const userId = request.authUser?.id;
    if (!userId) {
      throw new ForbiddenException("No authenticated user on request");
    }

    const membership = await this.prisma.membership.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    if (!membership) {
      throw new ForbiddenException("No account membership found for this user");
    }

    request.membership = {
      accountId: membership.accountId,
      role: membership.role,
      userId: membership.userId,
    };
    return true;
  }
}
