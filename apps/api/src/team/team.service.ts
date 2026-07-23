import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Invite, MembershipRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { AuditService } from "../audit/audit.service";
import { EMAIL_CLIENT, type EmailClient } from "../email/email.client";
import { escapeHtml, renderBrandedEmail } from "../email/email-layout";
import { generateInviteToken, INVITE_TTL_DAYS } from "../common/generate-invite-token";
import type { EnvConfig } from "../config/env.schema";
import type { AuthenticatedUser } from "../auth/types";
import { SAFE_ACCOUNT_SELECT, type SafeAccount } from "../accounts/accounts.service";
import type { CreateInviteDto } from "./dto/create-invite.dto";

export interface TeamMember {
  userId: string;
  email: string | null;
  role: MembershipRole;
  createdAt: Date;
  isYou: boolean;
}

/** An invite without its secret token — the token is only ever emailed. */
export type SafeInvite = Pick<Invite, "id" | "email" | "role" | "status" | "expiresAt" | "createdAt">;

export interface TeamView {
  members: TeamMember[];
  invites: SafeInvite[];
  teamSeatsEnabled: boolean;
  yourRole: MembershipRole;
}

const SAFE_INVITE_SELECT = {
  id: true,
  email: true,
  role: true,
  status: true,
  expiresAt: true,
  createdAt: true,
} as const;

/** Owner and admin can manage the team; staff cannot. */
function canManage(role: MembershipRole): boolean {
  return role === "owner" || role === "admin";
}

@Injectable()
export class TeamService {
  private readonly logger = new Logger(TeamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(EMAIL_CLIENT) private readonly email: EmailClient,
  ) {}

  /** The team panel: members, pending invites, and whether the plan allows
   * inviting more (so the UI can gate the form). Any member may view it. */
  async getTeam(accountId: string, viewerUserId: string, viewerRole: MembershipRole): Promise<TeamView> {
    const [memberships, invites, entitlement] = await Promise.all([
      this.prisma.membership.findMany({ where: { accountId }, orderBy: { createdAt: "asc" } }),
      this.prisma.invite.findMany({
        where: { accountId, status: "pending" },
        orderBy: { createdAt: "desc" },
        select: SAFE_INVITE_SELECT,
      }),
      this.entitlements.getForAccount(accountId),
    ]);

    return {
      members: memberships.map((m) => ({
        userId: m.userId,
        email: m.email,
        role: m.role,
        createdAt: m.createdAt,
        isYou: m.userId === viewerUserId,
      })),
      invites,
      teamSeatsEnabled: entitlement.teamSeatsEnabled,
      yourRole: viewerRole,
    };
  }

  async createInvite(
    accountId: string,
    actor: AuthenticatedUser,
    actorRole: MembershipRole,
    dto: CreateInviteDto,
  ): Promise<SafeInvite> {
    if (!canManage(actorRole)) {
      throw new ForbiddenException("Only an owner or admin can invite teammates");
    }
    const entitlement = await this.entitlements.getForAccount(accountId);
    if (!entitlement.teamSeatsEnabled) {
      throw new ForbiddenException("Adding team members is available on the Centre plan");
    }

    const email = dto.email.trim().toLowerCase();

    // Already a member? Nothing to invite.
    const existingMember = await this.prisma.membership.findFirst({
      where: { accountId, email: { equals: email, mode: "insensitive" } },
    });
    if (existingMember) {
      throw new ConflictException("That person is already on your team");
    }

    const token = generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    // Re-inviting the same email replaces the previous (pending/revoked) invite
    // with a fresh token and expiry, rather than erroring on the unique key.
    const invite = await this.prisma.invite.upsert({
      where: { accountId_email: { accountId, email } },
      create: {
        accountId,
        email,
        role: dto.role,
        token,
        status: "pending",
        invitedByUserId: actor.id,
        expiresAt,
      },
      update: {
        role: dto.role,
        token,
        status: "pending",
        invitedByUserId: actor.id,
        expiresAt,
        acceptedAt: null,
      },
      select: SAFE_INVITE_SELECT,
    });

    await this.sendInviteEmail(accountId, email, dto.role, token);

    await this.audit.record({
      accountId,
      actorUserId: actor.id,
      action: "invite",
      targetType: "Invite",
      targetId: invite.id,
      metadata: { email, role: dto.role },
    });

    return invite;
  }

  async revokeInvite(accountId: string, actorRole: MembershipRole, inviteId: string): Promise<void> {
    if (!canManage(actorRole)) {
      throw new ForbiddenException("Only an owner or admin can manage invites");
    }
    const { count } = await this.prisma.invite.updateMany({
      where: { id: inviteId, accountId, status: "pending" },
      data: { status: "revoked" },
    });
    if (count === 0) {
      throw new NotFoundException("Pending invite not found");
    }
  }

  async removeMember(
    accountId: string,
    actorRole: MembershipRole,
    actorUserId: string,
    targetUserId: string,
  ): Promise<void> {
    if (!canManage(actorRole)) {
      throw new ForbiddenException("Only an owner or admin can remove teammates");
    }
    if (targetUserId === actorUserId) {
      throw new BadRequestException("You can't remove yourself from the team");
    }
    const target = await this.prisma.membership.findFirst({
      where: { accountId, userId: targetUserId },
    });
    if (!target) {
      throw new NotFoundException("Team member not found");
    }
    if (target.role === "owner") {
      throw new ForbiddenException("The account owner can't be removed");
    }
    // An admin can only remove staff; only the owner can remove another admin.
    if (actorRole === "admin" && target.role === "admin") {
      throw new ForbiddenException("Only the owner can remove an admin");
    }

    await this.prisma.membership.delete({ where: { id: target.id } });
    await this.audit.record({
      accountId,
      actorUserId,
      action: "remove_member",
      targetType: "Membership",
      targetId: targetUserId,
      metadata: { role: target.role },
    });
  }

  async updateMemberRole(
    accountId: string,
    actorRole: MembershipRole,
    actorUserId: string,
    targetUserId: string,
    role: "admin" | "staff",
  ): Promise<void> {
    // Changing roles is an owner-only power (an admin can't promote themselves).
    if (actorRole !== "owner") {
      throw new ForbiddenException("Only the owner can change roles");
    }
    const target = await this.prisma.membership.findFirst({
      where: { accountId, userId: targetUserId },
    });
    if (!target) {
      throw new NotFoundException("Team member not found");
    }
    if (target.role === "owner") {
      throw new ForbiddenException("The owner's role can't be changed");
    }
    await this.prisma.membership.update({ where: { id: target.id }, data: { role } });
    await this.audit.record({
      accountId,
      actorUserId,
      action: "change_role",
      targetType: "Membership",
      targetId: targetUserId,
      metadata: { role },
    });
  }

  /** Public preview for the accept page — reveals only what the token holder
   * (the intended invitee) needs to decide whether to accept. */
  async previewInvite(token: string): Promise<{
    accountName: string;
    email: string;
    role: MembershipRole;
    status: Invite["status"];
    expired: boolean;
  }> {
    const invite = await this.prisma.invite.findUnique({
      where: { token },
      include: { account: { select: { name: true } } },
    });
    if (!invite) {
      throw new NotFoundException("This invite link is invalid");
    }
    return {
      accountName: invite.account.name,
      email: invite.email,
      role: invite.role,
      status: invite.status,
      expired: invite.status === "pending" && invite.expiresAt.getTime() <= Date.now(),
    };
  }

  /**
   * Accept an invite: the authenticated user joins the account as the invited
   * role. Requires a valid, pending, unexpired token AND that the user's
   * verified email matches the invite's — so a forwarded link can't be redeemed
   * by someone else. One-user-one-account still holds (mirrors the guest claim):
   * a user who already belongs to an account can't accept.
   */
  async acceptInvite(user: AuthenticatedUser, token: string): Promise<SafeAccount> {
    if (!user.email) {
      throw new ForbiddenException("Your login has no email address");
    }
    const email = user.email;

    return this.prisma.$transaction(async (tx) => {
      const invite = await tx.invite.findUnique({ where: { token } });
      if (!invite || invite.status !== "pending") {
        throw new NotFoundException("This invite link is invalid or has already been used");
      }
      if (invite.expiresAt.getTime() <= Date.now()) {
        throw new BadRequestException("This invite has expired — ask for a new one");
      }
      if (invite.email.toLowerCase() !== email.toLowerCase()) {
        throw new ForbiddenException("This invite was sent to a different email address");
      }
      const existing = await tx.membership.findFirst({ where: { userId: user.id } });
      if (existing) {
        throw new ConflictException(
          "You already belong to a Kudos account — log in to that one to switch",
        );
      }

      await tx.membership.create({
        data: { accountId: invite.accountId, userId: user.id, role: invite.role, email },
      });
      await tx.invite.update({
        where: { id: invite.id },
        data: { status: "accepted", acceptedAt: new Date() },
      });

      return tx.account.findUniqueOrThrow({
        where: { id: invite.accountId },
        select: SAFE_ACCOUNT_SELECT,
      });
    });
  }

  private async sendInviteEmail(
    accountId: string,
    email: string,
    role: MembershipRole,
    token: string,
  ): Promise<void> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { name: true },
    });
    const webAppUrl = this.config.get("WEB_APP_URL", { infer: true });
    const acceptUrl = `${webAppUrl}/invite/${token}`;
    const accountName = account?.name ?? "a Kudos Cards account";

    try {
      await this.email.sendTransactional({
        to: email,
        subject: `You've been invited to join ${accountName} on Kudos Cards`,
        html: renderBrandedEmail({
          webAppUrl,
          preheader: `Join ${accountName} on Kudos Cards`,
          heading: "You're invited",
          bodyHtml: `
            <p>You've been invited to join <strong>${escapeHtml(accountName)}</strong> on Kudos
            Cards as ${escapeHtml(role)}.</p>
            <p>Click below to accept — you'll sign in (or create a login) with
            <strong>${escapeHtml(email)}</strong> and go straight to the team's dashboard.</p>`,
          cta: { url: acceptUrl, label: "Accept invitation" },
          showLinkFallback: true,
          footerNote: "If you weren't expecting this, you can safely ignore this email.",
        }),
      });
    } catch (error) {
      // A failed send shouldn't fail the whole invite — the row exists and the
      // inviter can re-send. Log it so it's visible.
      const reason = error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Invite email to ${email} failed: ${reason}`);
    }
  }
}
