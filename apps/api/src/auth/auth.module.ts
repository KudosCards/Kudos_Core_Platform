import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { jwksResolverProvider } from "./jwks.provider";
import { MembershipGuard } from "./membership.guard";
import { PlatformAdminGuard } from "./platform-admin.guard";

/**
 * JwtAuthGuard is global (every route requires a valid Supabase JWT unless
 * marked @Public()). MembershipGuard and PlatformAdminGuard are NOT global —
 * they're applied per controller/route (account-creation routes must run
 * before a Membership exists, and only ops routes require platform admin).
 */
@Global()
@Module({
  providers: [
    jwksResolverProvider,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    MembershipGuard,
    PlatformAdminGuard,
  ],
  exports: [MembershipGuard, PlatformAdminGuard],
})
export class AuthModule {}
