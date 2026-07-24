import { z } from "zod";

/**
 * Platform-operator (super admin) identity & team management. Distinct from a
 * tuition centre's Membership — this is Kudos's own internal staff. See
 * docs/adr/0040-admin-auth.md.
 */

export const platformAdminRoleSchema = z.enum(["super_admin", "ops"]);
export type PlatformAdminRole = z.infer<typeof platformAdminRoleSchema>;

/** The signed-in operator, as returned by GET /admin/me and POST /admin/access. */
export const adminIdentitySchema = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  role: platformAdminRoleSchema,
});
export type AdminIdentity = z.infer<typeof adminIdentitySchema>;

/** One operator in the team-management list. */
export const adminTeamMemberSchema = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  role: platformAdminRoleSchema,
  createdAt: z.coerce.date(),
  /** True for the row representing the current viewer. */
  isYou: z.boolean(),
});
export type AdminTeamMember = z.infer<typeof adminTeamMemberSchema>;

/** A pending email allow-list entry (operator not yet signed in). */
export const adminInviteSchema = z.object({
  email: z.string().email(),
  role: platformAdminRoleSchema,
  createdAt: z.coerce.date(),
});
export type AdminInvite = z.infer<typeof adminInviteSchema>;

/** GET /admin/team — operators, pending invites, and the viewer's role. */
export const adminTeamSchema = z.object({
  admins: z.array(adminTeamMemberSchema),
  invites: z.array(adminInviteSchema),
  yourRole: platformAdminRoleSchema,
});
export type AdminTeam = z.infer<typeof adminTeamSchema>;

/** Body for POST /admin/team/invites. */
export const inviteAdminInputSchema = z.object({
  email: z.string().email(),
  role: platformAdminRoleSchema,
});
export type InviteAdminInput = z.infer<typeof inviteAdminInputSchema>;

/** Body for PATCH /admin/team/:userId. */
export const setAdminRoleInputSchema = z.object({
  role: platformAdminRoleSchema,
});
export type SetAdminRoleInput = z.infer<typeof setAdminRoleInputSchema>;
