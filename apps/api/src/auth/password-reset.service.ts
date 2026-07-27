import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EnvConfig } from "../config/env.schema";
import { EMAIL_CLIENT, type EmailClient } from "../email/email.client";
import { escapeHtml, renderBrandedEmail } from "../email/email-layout";
import { SUPABASE_ADMIN_CLIENT } from "../supabase/supabase-admin.provider";
import { generateAuthLink } from "../supabase/generate-auth-link";

/**
 * Platform-wide "forgot password". Mints a Supabase recovery link (service-role)
 * and emails it via our branded Brevo path, landing the user on /reset-password
 * to set a new password. Deliberately never reveals whether an email has an
 * account: unknown addresses and send failures are logged, and the caller always
 * returns 200. Works for both customers and operators. See docs/adr/0051.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(EMAIL_CLIENT) private readonly email: EmailClient,
    @Inject(SUPABASE_ADMIN_CLIENT) private readonly supabaseAdmin: SupabaseClient,
  ) {}

  async requestReset(rawEmail: string): Promise<void> {
    const email = rawEmail.trim().toLowerCase();
    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    try {
      const { actionLink } = await generateAuthLink(this.supabaseAdmin, {
        type: "recovery",
        email,
        redirectTo: `${webAppUrl}/reset-password`,
      });
      // No account for this email — stay silent (don't leak which emails exist).
      if (!actionLink) {
        return;
      }
      await this.email.sendTransactional({
        to: email,
        subject: "Reset your Kudos Cards password",
        html: renderBrandedEmail({
          webAppUrl,
          preheader: "Reset your Kudos Cards password",
          heading: "Reset your password",
          bodyHtml: `
            <p>We received a request to reset the password for
            <strong>${escapeHtml(email)}</strong>. Click below to choose a new one.</p>
            <p>This link expires shortly. If you didn't ask to reset your password, you can safely
            ignore this email — your current password will keep working.</p>`,
          cta: { url: actionLink, label: "Choose a new password" },
          showLinkFallback: true,
        }),
      });
    } catch (error) {
      // Never surface — a reset request must not reveal account existence or
      // config problems to the caller. Log for operators.
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Password reset for ${email} failed: ${reason}`);
    }
  }
}
