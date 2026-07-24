import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
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

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Called right after admin sign-in. If the user is already an operator, return
   * their identity (refreshing their stored email). Otherwise, if their verified
   * email is on the allow-list, provision them as an operator and consume the
   * invite. Anyone else is refused — this is the gate that keeps the admin app
   * to Kudos staff.
   */
  async access(user: AuthenticatedUser): Promise<AdminIdentity> {
    const email = user.email?.trim().toLowerCase() ?? null;

    const existing = await this.prisma.platformAdmin.findUnique({ where: { userId: user.id } });
    if (existing) {
      if (email && existing.email !== email) {
        await this.prisma.platformAdmin.update({ where: { userId: user.id }, data: { email } });
      }
      return { userId: user.id, email: email ?? existing.email, role: coerceRole(existing.role) };
    }

    if (!email) {
      throw new ForbiddenException("This account isn't a Kudos operator");
    }
    const invite = await this.prisma.platformAdminInvite.findUnique({ where: { email } });
    if (!invite) {
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
    const alreadyAdmin = await this.prisma.platformAdmin.findFirst({ where: { email: normalised } });
    if (alreadyAdmin) {
      throw new ConflictException("That email is already an operator");
    }
    await this.prisma.platformAdminInvite.upsert({
      where: { email: normalised },
      create: { email: normalised, role, invitedByUserId: currentUserId },
      update: { role, invitedByUserId: currentUserId },
    });
  }

  async removeInvite(email: string): Promise<void> {
    await this.prisma.platformAdminInvite.deleteMany({ where: { email: email.trim().toLowerCase() } });
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
