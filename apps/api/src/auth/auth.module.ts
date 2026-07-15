import { Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { MembershipGuard } from "./membership.guard";

/**
 * JwtAuthGuard is global (every route requires a valid Supabase JWT unless
 * marked @Public()). MembershipGuard is NOT global — it's applied per
 * controller/route, since account-creation routes must run before a
 * Membership exists.
 */
@Global()
@Module({
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    MembershipGuard,
  ],
  exports: [MembershipGuard],
})
export class AuthModule {}
