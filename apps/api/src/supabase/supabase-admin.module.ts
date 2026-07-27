import { Global, Module } from "@nestjs/common";
import { SUPABASE_ADMIN_CLIENT, supabaseAdminProvider } from "./supabase-admin.provider";

/**
 * Global so any feature (operator invites, password reset) can inject the
 * service-role Supabase admin client without re-wiring the provider — mirrors
 * EmailModule. See supabase-admin.provider.ts and docs/adr/0051-operator-password-setup.md.
 */
@Global()
@Module({
  providers: [supabaseAdminProvider],
  exports: [SUPABASE_ADMIN_CLIENT],
})
export class SupabaseAdminModule {}
