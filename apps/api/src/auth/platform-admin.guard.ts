import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Grants access only to Kudos Cards internal operators (rows in
 * platform_admins), a separate authorization axis from MembershipGuard's
 * per-account access. Must run after JwtAuthGuard (needs request.authUser).
 * See docs/adr/0010-phase-5-fulfillment-ops.md.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const userId = request.authUser?.id;
    if (!userId) {
      throw new ForbiddenException("No authenticated user on request");
    }

    const admin = await this.prisma.platformAdmin.findUnique({ where: { userId } });
    if (!admin) {
      throw new ForbiddenException("Platform operator access required");
    }

    request.platformAdmin = { userId };
    return true;
  }
}
