import { z } from "zod";
import { accountTypeSchema, membershipRoleSchema } from "./enums";

export const accountSchema = z.object({
  id: z.string().uuid(),
  type: accountTypeSchema,
  name: z.string().min(1).max(200),
  stripeCustomerId: z.string().nullable(),
  planId: z.string().nullable(),
  /** Whether upcoming-birthday reminder emails are on for this account (opt-out). */
  reminderEmailsEnabled: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Account = z.infer<typeof accountSchema>;

/** Body for PATCH /accounts/me/notifications. */
export const updateNotificationsInputSchema = z.object({
  reminderEmailsEnabled: z.boolean(),
});
export type UpdateNotificationsInput = z.infer<typeof updateNotificationsInputSchema>;

export const createAccountInputSchema = z.object({
  type: accountTypeSchema,
  name: z.string().min(1).max(200),
});
export type CreateAccountInput = z.infer<typeof createAccountInputSchema>;

export const membershipSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  userId: z.string().uuid(),
  role: membershipRoleSchema,
  createdAt: z.coerce.date(),
});
export type Membership = z.infer<typeof membershipSchema>;

// ---------------------------------------------------------------------------
// Team management (multi-user orgs) — see docs/adr/0028-multi-user-teams.md.
// ---------------------------------------------------------------------------

/** A member as shown in the team-management UI (never exposes the raw userId
 * beyond what the account already owns). */
export const teamMemberSchema = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  role: membershipRoleSchema,
  createdAt: z.coerce.date(),
  /** True for the row representing the current viewer. */
  isYou: z.boolean(),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

export const inviteStatusSchema = z.enum(["pending", "accepted", "revoked"]);
export type InviteStatus = z.infer<typeof inviteStatusSchema>;

/** A team invite, WITHOUT its secret token (the token is only ever emailed). */
export const inviteSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: membershipRoleSchema,
  status: inviteStatusSchema,
  expiresAt: z.coerce.date(),
  createdAt: z.coerce.date(),
});
export type Invite = z.infer<typeof inviteSchema>;

/** GET /team — the account's members, pending invites, and whether the plan
 * allows adding more (so the UI can gate the invite form). */
export const teamSchema = z.object({
  members: z.array(teamMemberSchema),
  invites: z.array(inviteSchema),
  teamSeatsEnabled: z.boolean(),
  /** The viewer's own role, so the UI can show/hide management controls. */
  yourRole: membershipRoleSchema,
});
export type Team = z.infer<typeof teamSchema>;

/** Body for POST /team/invites. Owners/admins invite an admin or staff member
 * (never another owner — an account has exactly one). */
export const createInviteInputSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "staff"]),
});
export type CreateInviteInput = z.infer<typeof createInviteInputSchema>;

/** GET /invites/:token — the public preview shown on the accept page. */
export const invitePreviewSchema = z.object({
  accountName: z.string(),
  email: z.string().email(),
  role: membershipRoleSchema,
  status: inviteStatusSchema,
  /** True when the invite is pending but past its expiry. */
  expired: z.boolean(),
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;
