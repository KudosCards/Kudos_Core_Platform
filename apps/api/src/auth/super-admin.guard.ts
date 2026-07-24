import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";

/**
 * Restricts a route to **super admins** — the operators who manage the operator
 * team and platform settings. Must run *after* PlatformAdminGuard (it reads the
 * role that guard resolved), so list both: `@UseGuards(PlatformAdminGuard,
 * SuperAdminGuard)`. See docs/adr/0040-admin-auth.md.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.platformAdmin?.role !== "super_admin") {
      throw new ForbiddenException("Super admin access required");
    }
    return true;
  }
}
