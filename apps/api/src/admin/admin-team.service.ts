import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PrismaService } from "../prisma/prisma.service";
import type { EnvConfig } from "../config/env.schema";
import { EMAIL_CLIENT, type EmailClient } from "../email/email.client";
import { escapeHtml, renderBrandedEmail } from "../email/email-layout";
import { SUPABASE_ADMIN_CLIENT } from "../supabase/supabase-admin.provider";
import { type AuthLinkType, generateAuthLink } from "../supabase/generate-auth-link";
import type { AuthenticatedUser, PlatformAdminRole } from "../auth/types";

export interface AdminIdentity {
  userId: string;
  email: string | null;
  role: PlatformAdminRole;
}

export interface AdminTeam {
  admins: Array<{
    userId: string;
    email: string | null;
    role: PlatformAdminRole;
    createdAt: Date;
    isYou: boolean;
  }>;
  invites: Array<{ email: string; role: PlatformAdminRole; createdAt: Date }>;
  yourRole: PlatformAdminRole;
}

const coerceRole = (role: string): PlatformAdminRole =>
  role === "super_admin" ? "super_admin" : "ops";

/**
 * Kudos operator identity & team management (the "super admin" surface). A super
 * admin allow-lists an operator's email; when that person signs in at the admin
 * login with a matching **verified** Supabase email, they're provisioned here.
 * At least one super admin is always kept. See docs/adr/0040-admin-auth.md.
 */
@Injectable()
export class AdminTeamService {
  private readonly logger = new Logger(AdminTeamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(EMAIL_CLIENT) private readonly email: EmailClient,
    @Inject(SUPABASE_ADMIN_CLIENT) private readonly supabaseAdmin: SupabaseClient,
  ) {}

  /**
   * Called right after admin sign-in. If the user is already an operator, return
   * their identity (refreshing their stored email). Otherwise, if their verified
   * email is on the allow-list, provision them as an operator and consume the
   * invite. Anyone else is refused — this is the gate that keeps the admin app
   * to Kudos staff.
   */
  async access(user: AuthenticatedUser): Promise<AdminIdentity> {
    const email = await this.resolveOperatorEmail(user);

    const existing = await this.prisma.platformAdmin.findUnique({ where: { userId: user.id } });
    if (existing) {
      if (email && existing.email !== email) {
        await this.prisma.platformAdmin.update({ where: { userId: user.id }, data: { email } });
      }
      return { userId: user.id, email: email ?? existing.email, role: coerceRole(existing.role) };
    }

    if (!email) {
      this.logger.warn(
        `Operator access refused for user ${user.id}: no email resolved from the session`,
      );
      throw new ForbiddenException("This account isn't a Kudos operator");
    }
    const invite = await this.prisma.platformAdminInvite.findUnique({ where: { email } });
    if (!invite) {
      this.logger.warn(
        `Operator access refused for ${email}: no matching invite on the allow-list`,
      );
      throw new ForbiddenException("This account isn't a Kudos operator");
    }

    const role = coerceRole(invite.role);
    await this.prisma.$transaction(async (tx) => {
      await tx.platformAdmin.create({ data: { userId: user.id, role, email } });
      await tx.platformAdminInvite.delete({ where: { email } });
    });
    this.logger.log(`Provisioned operator ${email} as ${role}`);
    return { userId: user.id, email, role };
  }

  /**
   * The operator's normalised email for the allow-list check. Prefers the
   * verified JWT `email` claim, but falls back to the authoritative Supabase
   * user record (keyed on the JWT-verified user id) when the claim is absent —
   * some sessions minted from an invite/recovery link don't populate it, which
   * would otherwise dead-end a validly-invited operator at "not a Kudos
   * operator". Returns null only if neither source yields an email.
   */
  private async resolveOperatorEmail(user: AuthenticatedUser): Promise<string | null> {
    const fromToken = user.email?.trim().toLowerCase();
    if (fromToken) {
      return fromToken;
    }
    try {
      const { data, error } = await this.supabaseAdmin.auth.admin.getUserById(user.id);
      if (error) {
        this.logger.warn(`Could not resolve email for operator ${user.id}: ${error.message}`);
        return null;
      }
      return data.user?.email?.trim().toLowerCase() ?? null;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.logger.warn(`Email lookup failed for operator ${user.id}: ${reason}`);
      return null;
    }
  }

  /** The signed-in operator (after PlatformAdminGuard). Keeps the stored email fresh. */
  async me(user: AuthenticatedUser): Promise<AdminIdentity> {
    const admin = await this.prisma.platformAdmin.findUniqueOrThrow({ where: { userId: user.id } });
    const email = user.email?.trim().toLowerCase() ?? admin.email;
    if (email && admin.email !== email) {
      await this.prisma.platformAdmin.update({ where: { userId: user.id }, data: { email } });
    }
    return { userId: user.id, email, role: coerceRole(admin.role) };
  }

  async listTeam(currentUserId: string): Promise<AdminTeam> {
    const [admins, invites] = await Promise.all([
      this.prisma.platformAdmin.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.platformAdminInvite.findMany({ orderBy: { createdAt: "asc" } }),
    ]);
    const you = admins.find((a) => a.userId === currentUserId);
    return {
      admins: admins.map((a) => ({
        userId: a.userId,
        email: a.email,
        role: coerceRole(a.role),
        createdAt: a.createdAt,
        isYou: a.userId === currentUserId,
      })),
      invites: invites.map((i) => ({
        email: i.email,
        role: coerceRole(i.role),
        createdAt: i.createdAt,
      })),
      yourRole: coerceRole(you?.role ?? "ops"),
    };
  }

  /** Allow-list an email as an operator (super admin only). */
  async invite(currentUserId: string, email: string, role: PlatformAdminRole): Promise<void> {
    const normalised = email.trim().toLowerCase();
    const alreadyAdmin = await this.prisma.platformAdmin.findFirst({
      where: { email: normalised },
    });
    if (alreadyAdmin) {
      throw new ConflictException("That email is already an operator");
    }
    await this.prisma.platformAdminInvite.upsert({
      where: { email: normalised },
      create: { email: normalised, role, invitedByUserId: currentUserId },
      update: { role, invitedByUserId: currentUserId },
    });
    // The allow-list row is the source of truth — a failed email must NOT fail
    // the invite (the operator can still sign in, and the email can be resent),
    // so swallow-and-log here. The explicit "Resend" action surfaces failures.
    try {
      await this.sendInviteEmail(normalised, role);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Operator invite email to ${normalised} failed: ${reason}`);
    }
  }

  /** Whether transactional email is actually configured (a Brevo key + a sender
   * for the HTML fallbacks the invites use). When false, invite/resend emails
   * are silently dropped by the no-op client — surfaced as a banner in the UI. */
  emailConfigured(): { configured: boolean } {
    const apiKey = this.config.get("Brevo_API", { infer: true });
    const fromAddress = this.config.get("EMAIL_FROM_ADDRESS", { infer: true });
    return { configured: Boolean(apiKey && fromAddress) };
  }

  async removeInvite(email: string): Promise<void> {
    await this.prisma.platformAdminInvite.deleteMany({
      where: { email: email.trim().toLowerCase() },
    });
  }

  /** Re-send the invite email for a still-pending operator (in case the first
   * one was lost). 404s if there's no pending invite for that address. */
  async resendInvite(email: string): Promise<void> {
    const normalised = email.trim().toLowerCase();
    const invite = await this.prisma.platformAdminInvite.findUnique({
      where: { email: normalised },
    });
    if (!invite) {
      throw new NotFoundException("No pending invite for that email");
    }
    // Unlike invite(), this is an explicit user action — surface a send failure
    // so the operator knows it didn't go out (rather than a false "Sent").
    try {
      await this.sendInviteEmail(normalised, coerceRole(invite.role));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Operator invite resend to ${normalised} failed: ${reason}`);
      throw new BadGatewayException(
        "Couldn't send the invite email — check the email configuration.",
      );
    }
  }

  /** Emails an invited operator a one-time link to set their password and land in
   * the ops app. A **new** operator gets an `invite` link (which also creates
   * their auth user); an operator whose email **already exists** in Supabase gets
   * a `recovery` link instead — an existing user may have been created by an
   * earlier invite and never set a password, so pointing them at "sign in" would
   * dead-end. Both land on /admin-set-password → /admin/access. Throws on a hard
   * failure; callers decide whether to swallow (invite) or surface (resend). See
   * docs/adr/0051. */
  private async sendInviteEmail(email: string, role: PlatformAdminRole): Promise<void> {
    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    const roleLabel = role === "super_admin" ? "a super admin" : "an operator";
    const redirectTo = `${webAppUrl}/admin-set-password`;

    // New user → `invite` (also creates the auth user). If Supabase reports the
    // email already exists, `hashedToken` is null; fall back to a `recovery`
    // token, which works for an existing user and still lets them set a password.
    let linkType: AuthLinkType = "invite";
    let { hashedToken } = await generateAuthLink(this.supabaseAdmin, {
      type: "invite",
      email,
      redirectTo,
    });
    if (!hashedToken) {
      linkType = "recovery";
      ({ hashedToken } = await generateAuthLink(this.supabaseAdmin, {
        type: "recovery",
        email,
        redirectTo,
      }));
    }
    if (!hashedToken) {
      // Neither token could be minted (no such user for recovery, yet invite said
      // it exists — shouldn't happen). Surface it so callers can log/resend
      // rather than silently sending nothing.
      throw new Error(`Could not mint a set-password link for ${email}`);
    }
    // Link to our own page with the token_hash; /admin-set-password verifies it
    // with supabase.auth.verifyOtp (no PKCE verifier needed, scanner-safe).
    const actionLink = `${redirectTo}?token_hash=${encodeURIComponent(hashedToken)}&type=${linkType}`;

    await this.email.sendTransactional({
      to: email,
      subject: "Set your password for the Kudos Cards operator dashboard",
      html: renderBrandedEmail({
        webAppUrl,
        preheader: "Set your password to access the Kudos Cards operator dashboard",
        heading: "Set your operator password",
        bodyHtml: `
          <p>You've been granted access to the Kudos Cards operator dashboard as
          <strong>${escapeHtml(roleLabel)}</strong>.</p>
          <p>Set a password for <strong>${escapeHtml(email)}</strong> to finish setting up your
          login — then you'll see orders, customers, the fulfillment queue and more.</p>`,
        cta: { url: actionLink, label: "Set your password" },
        showLinkFallback: true,
        footerNote: "If you weren't expecting this, you can safely ignore this email.",
      }),
    });
  }

  /** Change an operator's role. Refuses to remove the last super admin. */
  async setRole(targetUserId: string, role: PlatformAdminRole): Promise<void> {
    const target = await this.prisma.platformAdmin.findUnique({ where: { userId: targetUserId } });
    if (!target) {
      throw new NotFoundException("Operator not found");
    }
    if (coerceRole(target.role) === "super_admin" && role !== "super_admin") {
      await this.assertNotLastSuperAdmin();
    }
    await this.prisma.platformAdmin.update({ where: { userId: targetUserId }, data: { role } });
  }

  /** Remove an operator entirely. Refuses to remove the last super admin. */
  async revoke(targetUserId: string): Promise<void> {
    const target = await this.prisma.platformAdmin.findUnique({ where: { userId: targetUserId } });
    if (!target) {
      throw new NotFoundException("Operator not found");
    }
    if (coerceRole(target.role) === "super_admin") {
      await this.assertNotLastSuperAdmin();
    }
    await this.prisma.platformAdmin.delete({ where: { userId: targetUserId } });
  }

  private async assertNotLastSuperAdmin(): Promise<void> {
    const superCount = await this.prisma.platformAdmin.count({ where: { role: "super_admin" } });
    if (superCount <= 1) {
      throw new ConflictException("At least one super admin is required");
    }
  }
}
