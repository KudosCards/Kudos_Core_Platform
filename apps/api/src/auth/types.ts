import type { MembershipRole } from "@prisma/client";

/**
 * Populated by JwtAuthGuard from a cryptographically verified Supabase JWT.
 *
 * `id` is trustworthy: it is the `sub` of a signature-checked token.
 *
 * `unverifiedEmail` is **not** an identity. It is a claim the token carries, and
 * the name says so on purpose — it used to be called `email`, which read as
 * something proven and was used to authorize three different things. Use
 * `verifiedEmailFromToken` where the address decides an outcome, and prefer an
 * authoritative lookup where nothing else binds the request. See ADR 0188.
 */
export interface AuthenticatedUser {
  id: string;
  unverifiedEmail: string | null;
  /** Whether the token itself asserts the address has been confirmed. */
  emailVerified: boolean;
}

/** Populated by MembershipGuard once the user's account/role is resolved. */
export interface CurrentMembershipContext {
  accountId: string;
  role: MembershipRole;
  /** The acting Supabase Auth user id — needed for per-user state (e.g. the
   * notification inbox's read/unread, which is scoped to the individual). */
  userId: string;
}

/** A Kudos operator's role: "super_admin" manages the operator team + platform
 * settings; "ops" works the dashboards and fulfillment/returns queues. */
export type PlatformAdminRole = "super_admin" | "ops";

/** Populated by PlatformAdminGuard for internal Kudos operators. */
export interface PlatformAdminContext {
  userId: string;
  role: PlatformAdminRole;
}

/** Populated by ApiKeyGuard for the inbound integrations endpoint. */
export interface ApiKeyContext {
  accountId: string;
  keyId: string;
}

declare module "express" {
  interface Request {
    authUser?: AuthenticatedUser;
    membership?: CurrentMembershipContext;
    platformAdmin?: PlatformAdminContext;
    apiKey?: ApiKeyContext;
  }
}

/**
 * The signed-in user's email, but only when the token says it has been
 * confirmed. `null` otherwise — so a caller that authorizes on an address gets
 * nothing to compare against rather than an unproven string.
 *
 * Deliberately a function rather than a field: reaching for it is a decision,
 * and the alternative (`unverifiedEmail`) is named so that using the wrong one
 * is visible in the diff. See ADR 0188.
 */
export function verifiedEmailFromToken(user: AuthenticatedUser): string | null {
  return user.emailVerified ? user.unverifiedEmail : null;
}
